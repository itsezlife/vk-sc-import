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
		const burial = onDisk?.matchRecords.find(
			(record) => record.libraryTrack.title === 'Archangel'
		);
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
		const burial = onDisk?.matchRecords.find(
			(record) => record.libraryTrack.title === 'Archangel'
		);
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
