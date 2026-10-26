import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeSoundCloudGateway } from '$lib/soundcloud/fake-soundcloud-gateway';
import { createImportSessionApi } from './import-session-api';
import { createSessionFileStore } from './session-file-store';

/**
 * Seam: Import Session Match Resolution (pick / search-bind / skip + Session File).
 * Fake SoundCloudGateway — no live network.
 */
describe('Import Session Match Resolution seam', () => {
	let dataDir: string;
	let gateway: ReturnType<typeof createFakeSoundCloudGateway>;
	let api: ReturnType<typeof createImportSessionApi>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-import-resolve-'));
		gateway = createFakeSoundCloudGateway();
		gateway.connectAs({ id: 'u1', username: 'resolver' });
		api = createImportSessionApi({ dataDir, gateway });
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	async function seedMatchedSession() {
		await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([
				{ artist: 'Aphex Twin', title: 'Xtal' },
				{ artist: 'Burial', title: 'Archangel' },
				{ artist: 'Unknown Artist', title: 'Missing From Catalog' }
			])
		});

		gateway.setCatalog([
			{
				id: 'sc-xtal',
				artist: 'Aphex Twin',
				title: 'Xtal',
				permalinkUrl: 'https://soundcloud.com/aphex/xtal',
				previewUrl: 'https://example.test/xtal.mp3'
			},
			{
				id: 'sc-arch-a',
				artist: 'Burial',
				title: 'Archangel',
				permalinkUrl: 'https://soundcloud.com/burial/archangel-a',
				previewUrl: 'https://example.test/arch-a.mp3'
			},
			{
				id: 'sc-arch-b',
				artist: 'Burial',
				title: 'Archangel',
				permalinkUrl: 'https://soundcloud.com/burial/archangel-b'
			},
			{
				id: 'sc-search-hit',
				artist: 'Unknown Artist',
				title: 'Found By Hand',
				permalinkUrl: 'https://soundcloud.com/unknown/found'
			}
		]);

		await api.runCatalogMatch();
	}

	it('exposes Ambiguous then Unresolved queue items with candidates and listen URLs', async () => {
		await seedMatchedSession();

		const queue = await api.getResolutionQueue();

		expect(queue.items).toHaveLength(2);
		expect(queue.items[0]?.record.classification).toBe('ambiguous');
		expect(queue.items[0]?.record.libraryTrack).toEqual({
			artist: 'Burial',
			title: 'Archangel'
		});
		if (queue.items[0]?.record.classification === 'ambiguous') {
			expect(queue.items[0].record.candidates.map((c) => c.id).sort()).toEqual([
				'sc-arch-a',
				'sc-arch-b'
			]);
			const withPreview = queue.items[0].record.candidates.find((c) => c.id === 'sc-arch-a');
			expect(withPreview?.previewUrl).toBe('https://example.test/arch-a.mp3');
			expect(withPreview?.permalinkUrl).toBe('https://soundcloud.com/burial/archangel-a');
		}

		expect(queue.items[1]?.record.classification).toBe('unresolved');
		expect(queue.items[1]?.record.libraryTrack).toEqual({
			artist: 'Unknown Artist',
			title: 'Missing From Catalog'
		});
		expect(queue.matchBuckets).toEqual({
			auto: 1,
			ambiguous: 1,
			unresolved: 1,
			accepted: 0
		});
	});

	it('pick accepts a candidate, removes it from the queue, and persists an accepted Match Record', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous');
		expect(ambiguous).toBeDefined();

		const result = await api.acceptCandidate({
			matchIndex: ambiguous!.matchIndex,
			soundCloudTrackId: 'sc-arch-b'
		});

		expect(result.matchBuckets).toEqual({
			auto: 1,
			ambiguous: 0,
			unresolved: 1,
			accepted: 1
		});
		expect(result.session.matchBuckets).toEqual(result.matchBuckets);

		const queue = await api.getResolutionQueue();
		expect(queue.items.map((item) => item.record.classification)).toEqual(['unresolved']);

		const onDisk = await createSessionFileStore(dataDir).read();
		const burial = onDisk?.matchRecords.find((record) => record.libraryTrack.title === 'Archangel');
		expect(burial).toEqual({
			classification: 'accepted',
			libraryTrack: { artist: 'Burial', title: 'Archangel' },
			soundCloudTrack: {
				id: 'sc-arch-b',
				artist: 'Burial',
				title: 'Archangel',
				permalinkUrl: 'https://soundcloud.com/burial/archangel-b'
			},
			confidence: expect.any(Number)
		});
	});

	it('search-bind attaches a catalog hit to Unresolved and persists accepted', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const unresolved = before.items.find((item) => item.record.classification === 'unresolved');
		expect(unresolved).toBeDefined();

		const search = await api.searchCatalog({ query: 'Found By Hand' });
		expect(search.tracks.map((track) => track.id)).toContain('sc-search-hit');
		expect(gateway.calls.filter((name) => name === 'searchTracks').length).toBeGreaterThan(3);

		const hit = search.tracks.find((track) => track.id === 'sc-search-hit');
		expect(hit).toBeDefined();

		const result = await api.bindSearchResult({
			matchIndex: unresolved!.matchIndex,
			soundCloudTrack: hit!
		});

		expect(result.matchBuckets).toEqual({
			auto: 1,
			ambiguous: 1,
			unresolved: 0,
			accepted: 1
		});

		const queue = await api.getResolutionQueue();
		expect(queue.items.map((item) => item.record.classification)).toEqual(['ambiguous']);

		const onDisk = await createSessionFileStore(dataDir).read();
		const bound = onDisk?.matchRecords.find(
			(record) => record.libraryTrack.title === 'Missing From Catalog'
		);
		expect(bound?.classification).toBe('accepted');
		if (bound?.classification === 'accepted') {
			expect(bound.soundCloudTrack.id).toBe('sc-search-hit');
			expect(bound.confidence).toBe(1);
		}
	});

	it('skip moves Ambiguous to deferred Unresolved and advances the queue', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous');
		expect(ambiguous).toBeDefined();

		const result = await api.skipMatch({ matchIndex: ambiguous!.matchIndex });

		expect(result.matchBuckets).toEqual({
			auto: 1,
			ambiguous: 0,
			unresolved: 2,
			accepted: 0
		});

		const queue = await api.getResolutionQueue();
		expect(queue.items).toHaveLength(1);
		expect(queue.items[0]?.record.classification).toBe('unresolved');
		expect(queue.items[0]?.record.libraryTrack.title).toBe('Missing From Catalog');

		const onDisk = await createSessionFileStore(dataDir).read();
		const burial = onDisk?.matchRecords.find((record) => record.libraryTrack.title === 'Archangel');
		expect(burial).toEqual({
			classification: 'unresolved',
			libraryTrack: { artist: 'Burial', title: 'Archangel' },
			confidence: expect.any(Number),
			deferred: true
		});
	});

	it('skip on Unresolved defers it so the queue is not blocked', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous');
		await api.skipMatch({ matchIndex: ambiguous!.matchIndex });

		const unresolvedOnly = await api.getResolutionQueue();
		expect(unresolvedOnly.items).toHaveLength(1);
		const unresolved = unresolvedOnly.items[0]!;

		await api.skipMatch({ matchIndex: unresolved.matchIndex });

		const queue = await api.getResolutionQueue();
		expect(queue.items).toEqual([]);
		expect(queue.matchBuckets.unresolved).toBe(2);
	});

	it('reopen after skip restores the Ambiguous row with its candidates to the queue', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		await api.skipMatch({ matchIndex: ambiguous.matchIndex });
		expect((await api.getResolutionQueue()).reopenableCount).toBe(1);

		const result = await api.reopenMatch();

		expect(result.matchIndex).toBe(ambiguous.matchIndex);
		expect(result.matchBuckets).toEqual({ auto: 1, ambiguous: 1, unresolved: 1, accepted: 0 });
		const queue = await api.getResolutionQueue();
		expect(queue.items).toEqual(before.items);
		expect(queue.reopenableCount).toBe(0);
	});

	it('reopen survives a reload — history lives in the Session File', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		await api.acceptCandidate({
			matchIndex: ambiguous.matchIndex,
			soundCloudTrackId: 'sc-arch-a'
		});

		const reloaded = createImportSessionApi({ dataDir, gateway });
		await reloaded.reopenMatch();

		const onDisk = await createSessionFileStore(dataDir).read();
		expect(onDisk?.matchRecords[ambiguous.matchIndex]).toEqual(ambiguous.record);
		expect(onDisk?.resolutionHistory).toBeUndefined();
	});

	it('reopen walks back newest first and clears deferred on an Unresolved row', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		const unresolved = before.items.find((item) => item.record.classification === 'unresolved')!;
		await api.skipMatch({ matchIndex: ambiguous.matchIndex });
		await api.skipMatch({ matchIndex: unresolved.matchIndex });
		expect((await api.getResolutionQueue()).items).toEqual([]);

		expect((await api.reopenMatch()).matchIndex).toBe(unresolved.matchIndex);
		expect((await api.getResolutionQueue()).items.map((item) => item.matchIndex)).toEqual([
			unresolved.matchIndex
		]);

		expect((await api.reopenMatch()).matchIndex).toBe(ambiguous.matchIndex);
		await expect(api.reopenMatch()).rejects.toThrow(/No Match Resolution decision/);
	});

	it('drops a history entry that went stale instead of blocking older ones', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		const unresolved = before.items.find((item) => item.record.classification === 'unresolved')!;
		await api.skipMatch({ matchIndex: ambiguous.matchIndex });
		await api.skipMatch({ matchIndex: unresolved.matchIndex });

		// Simulate the newest row changing outside Match Resolution.
		const store = createSessionFileStore(dataDir);
		const session = (await store.read())!;
		const matchRecords = session.matchRecords.slice();
		matchRecords[unresolved.matchIndex] = unresolved.record;
		await store.write({ ...session, matchRecords });

		await expect(api.reopenMatch()).rejects.toThrow(/not a Match Resolution decision/);
		expect((await api.getResolutionQueue()).reopenableCount).toBe(1);
		expect((await api.reopenMatch()).matchIndex).toBe(ambiguous.matchIndex);
	});

	it('a fresh Catalog Match pass clears the undo history', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		await api.skipMatch({ matchIndex: before.items[0]!.matchIndex });

		await api.runCatalogMatch({ paceMs: 0 });

		expect((await api.getResolutionQueue()).reopenableCount).toBe(0);
	});

	it('lists Accepted and skipped rows as decided, not Auto-Match', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		const unresolved = before.items.find((item) => item.record.classification === 'unresolved')!;
		await api.acceptCandidate({
			matchIndex: ambiguous.matchIndex,
			soundCloudTrackId: 'sc-arch-a'
		});
		await api.skipMatch({ matchIndex: unresolved.matchIndex });

		const decided = await api.getDecidedList();

		expect(decided.items.map((item) => item.matchIndex).sort()).toEqual(
			[ambiguous.matchIndex, unresolved.matchIndex].sort()
		);
		expect(decided.acceptedLocked).toBe(false);
		expect((await api.getResolutionQueue()).decidedCount).toBe(2);
	});

	it('orders the Decided list by most recent decision, not library position', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		const unresolved = before.items.find((item) => item.record.classification === 'unresolved')!;
		// Decide the later library row first, then the earlier one.
		await api.skipMatch({ matchIndex: unresolved.matchIndex });
		await api.skipMatch({ matchIndex: ambiguous.matchIndex });
		expect(ambiguous.matchIndex).toBeLessThan(unresolved.matchIndex);

		const decided = await api.getDecidedList();

		expect(decided.items.map((item) => item.matchIndex)).toEqual([
			ambiguous.matchIndex,
			unresolved.matchIndex
		]);
	});

	it('reopenDecided uses the history entry when present, restoring candidates', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		const unresolved = before.items.find((item) => item.record.classification === 'unresolved')!;
		await api.acceptCandidate({
			matchIndex: ambiguous.matchIndex,
			soundCloudTrackId: 'sc-arch-a'
		});
		await api.skipMatch({ matchIndex: unresolved.matchIndex });

		// Not the newest decision — Back alone could not reach it first.
		const result = await api.reopenDecided({ matchIndex: ambiguous.matchIndex });

		expect(result.matchIndex).toBe(ambiguous.matchIndex);
		const onDisk = await createSessionFileStore(dataDir).read();
		expect(onDisk?.matchRecords[ambiguous.matchIndex]).toEqual(ambiguous.record);
		// Its history entry is consumed; Back now reaches the skip.
		expect(onDisk?.resolutionHistory?.map((entry) => entry.matchIndex)).toEqual([
			unresolved.matchIndex
		]);
	});

	it('reopenDecided without history reopens an Accepted row as Unresolved in the queue', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;
		await api.acceptCandidate({
			matchIndex: ambiguous.matchIndex,
			soundCloudTrackId: 'sc-arch-a'
		});
		// Simulate a decision made before history existed.
		const store = createSessionFileStore(dataDir);
		const session = (await store.read())!;
		const { resolutionHistory: _history, ...legacy } = session;
		void _history;
		await store.write(legacy);

		await api.reopenDecided({ matchIndex: ambiguous.matchIndex });

		const queue = await api.getResolutionQueue();
		const reopened = queue.items.find((item) => item.matchIndex === ambiguous.matchIndex);
		expect(reopened?.record).toEqual({
			classification: 'unresolved',
			libraryTrack: ambiguous.record.libraryTrack,
			confidence: ambiguous.record.confidence
		});
	});

	it('reopenDecided rejects rows the user never decided', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous')!;

		await expect(api.reopenDecided({ matchIndex: ambiguous.matchIndex })).rejects.toThrow(
			/not a decided row/
		);
	});

	it('rejects pick of a track that is not a candidate on that Ambiguous Match', async () => {
		await seedMatchedSession();
		const before = await api.getResolutionQueue();
		const ambiguous = before.items.find((item) => item.record.classification === 'ambiguous');

		await expect(
			api.acceptCandidate({
				matchIndex: ambiguous!.matchIndex,
				soundCloudTrackId: 'sc-xtal'
			})
		).rejects.toThrow(/candidate/i);
	});
});
