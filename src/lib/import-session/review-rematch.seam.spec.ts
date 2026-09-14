import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeSoundCloudGateway } from '$lib/soundcloud/fake-soundcloud-gateway';
import { createImportSessionApi } from './import-session-api';
import { createSessionFileStore } from './session-file-store';

/**
 * Seam: post-write Match Record review + Rematch (playlist membership + Session File).
 * Fake SoundCloudGateway — no live network.
 */
describe('Import Session review + Rematch seam', () => {
	let dataDir: string;
	let gateway: ReturnType<typeof createFakeSoundCloudGateway>;
	let api: ReturnType<typeof createImportSessionApi>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-import-review-'));
		gateway = createFakeSoundCloudGateway();
		gateway.connectAs({ id: 'u1', username: 'reviewer' });
		api = createImportSessionApi({ dataDir, gateway });
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	async function seedWrittenSession() {
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
				id: 'sc-xtal-alt',
				artist: 'Aphex Twin',
				title: 'Xtal (alt)',
				permalinkUrl: 'https://soundcloud.com/aphex/xtal-alt',
				previewUrl: 'https://example.test/xtal-alt.mp3'
			},
			{
				id: 'sc-arch-a',
				artist: 'Burial',
				title: 'Archangel',
				permalinkUrl: 'https://soundcloud.com/burial/archangel-a'
			},
			{
				id: 'sc-arch-b',
				artist: 'Burial',
				title: 'Archangel',
				permalinkUrl: 'https://soundcloud.com/burial/archangel-b'
			}
		]);
		gateway.setLikedTrackIds(['sc-xtal']);

		await api.runCatalogMatch();

		const queue = await api.getResolutionQueue();
		const ambiguous = queue.items.find((item) => item.record.classification === 'ambiguous');
		await api.acceptCandidate({
			matchIndex: ambiguous!.matchIndex,
			soundCloudTrackId: 'sc-arch-a'
		});

		const afterAccept = await api.getResolutionQueue();
		const unresolved = afterAccept.items.find(
			(item) => item.record.classification === 'unresolved'
		);
		await api.skipMatch({ matchIndex: unresolved!.matchIndex });

		await api.writeImportPlaylist({
			paceMs: 0,
			now: new Date('2026-09-14T12:00:00.000Z')
		});
	}

	it('lists bound Match Records with confidence and Library ↔ SoundCloud pairs after write', async () => {
		await seedWrittenSession();

		const review = await api.getReviewList();

		expect(review.items).toHaveLength(2);
		expect(review.items.map((item) => item.record.libraryTrack.title)).toEqual([
			'Xtal',
			'Archangel'
		]);

		const xtal = review.items[0]!;
		expect(xtal.record.classification).toBe('auto');
		expect(xtal.record.confidence).toBeGreaterThan(0);
		if (xtal.record.classification === 'auto') {
			expect(xtal.record.soundCloudTrack.id).toBe('sc-xtal');
			expect(xtal.record.alreadyOnSc).toBe(true);
		}

		const burial = review.items[1]!;
		expect(burial.record.classification).toBe('accepted');
		if (burial.record.classification === 'accepted') {
			expect(burial.record.soundCloudTrack.id).toBe('sc-arch-a');
		}
	});

	it('returns an empty review list before Import Playlist write', async () => {
		await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([{ artist: 'Aphex Twin', title: 'Xtal' }])
		});
		gateway.setCatalog([{ id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' }]);
		await api.runCatalogMatch();

		const review = await api.getReviewList();
		expect(review.items).toEqual([]);
		expect(review.matchBuckets.auto).toBe(1);
	});

	it('Rematch replaces the SoundCloud Track, updates Import Playlist membership, and persists', async () => {
		await seedWrittenSession();

		const review = await api.getReviewList();
		const xtal = review.items.find((item) => item.record.libraryTrack.title === 'Xtal')!;
		const playlistId = (await api.getSession()).session!.importPlaylist!.id;

		gateway.calls.length = 0;
		gateway.setLikedTrackIds(['sc-xtal-alt']);

		const result = await api.rematch({
			matchIndex: xtal.matchIndex,
			soundCloudTrack: {
				id: 'sc-xtal-alt',
				artist: 'Aphex Twin',
				title: 'Xtal (alt)',
				permalinkUrl: 'https://soundcloud.com/aphex/xtal-alt',
				previewUrl: 'https://example.test/xtal-alt.mp3'
			}
		});

		expect(result.session.importPlaylist?.id).toBe(playlistId);
		expect(gateway.calls.filter((name) => name === 'setPlaylistTracks')).toEqual([
			'setPlaylistTracks'
		]);
		expect(gateway.calls.filter((name) => name === 'listLikedTrackIds')).toEqual([
			'listLikedTrackIds'
		]);
		expect(gateway.playlistTrackIds(playlistId)).toEqual(['sc-xtal-alt', 'sc-arch-a']);

		const rematched = result.review.items.find(
			(item) => item.record.libraryTrack.title === 'Xtal'
		)!;
		expect(rematched.record.classification).toBe('accepted');
		if (rematched.record.classification === 'accepted') {
			expect(rematched.record.soundCloudTrack.id).toBe('sc-xtal-alt');
			expect(rematched.record.confidence).toBe(1);
			expect(rematched.record.alreadyOnSc).toBe(true);
		}

		const onDisk = await createSessionFileStore(dataDir).read();
		const diskXtal = onDisk?.matchRecords.find((r) => r.libraryTrack.title === 'Xtal');
		expect(diskXtal?.classification).toBe('accepted');
		if (diskXtal?.classification === 'accepted') {
			expect(diskXtal.soundCloudTrack.id).toBe('sc-xtal-alt');
			expect(diskXtal.alreadyOnSc).toBe(true);
		}
		expect(onDisk?.importPlaylist?.id).toBe(playlistId);
	});

	it('rejects Rematch when Import Playlist has not been written', async () => {
		await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([{ artist: 'Aphex Twin', title: 'Xtal' }])
		});
		gateway.setCatalog([{ id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' }]);
		await api.runCatalogMatch();

		await expect(
			api.rematch({
				matchIndex: 0,
				soundCloudTrack: {
					id: 'sc-xtal-alt',
					artist: 'Aphex Twin',
					title: 'Xtal (alt)'
				}
			})
		).rejects.toThrow(/import playlist/i);
	});

	it('rejects Rematch when SoundCloud is disconnected', async () => {
		await seedWrittenSession();
		const review = await api.getReviewList();
		await gateway.disconnect();

		await expect(
			api.rematch({
				matchIndex: review.items[0]!.matchIndex,
				soundCloudTrack: {
					id: 'sc-xtal-alt',
					artist: 'Aphex Twin',
					title: 'Xtal (alt)'
				}
			})
		).rejects.toThrow(/soundcloud/i);
	});

	it('rejects Rematch on an unbound Match Record', async () => {
		await seedWrittenSession();
		const onDisk = await createSessionFileStore(dataDir).read();
		const unresolvedIndex = onDisk!.matchRecords.findIndex(
			(r) => r.classification === 'unresolved'
		);

		await expect(
			api.rematch({
				matchIndex: unresolvedIndex,
				soundCloudTrack: {
					id: 'sc-xtal-alt',
					artist: 'Aphex Twin',
					title: 'Xtal (alt)'
				}
			})
		).rejects.toThrow(/bound/i);
	});
});
