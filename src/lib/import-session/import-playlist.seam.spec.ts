import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeSoundCloudGateway } from '$lib/soundcloud/fake-soundcloud-gateway';
import { createImportSessionApi } from './import-session-api';
import { createSessionFileStore } from './session-file-store';

/**
 * Seam: Import Playlist write (create + add + alreadyOnSc + Session File).
 * Fake SoundCloudGateway — no live network.
 */
describe('Import Session Import Playlist write seam', () => {
	let dataDir: string;
	let gateway: ReturnType<typeof createFakeSoundCloudGateway>;
	let api: ReturnType<typeof createImportSessionApi>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-import-playlist-'));
		gateway = createFakeSoundCloudGateway();
		gateway.connectAs({ id: 'u1', username: 'writer' });
		api = createImportSessionApi({ dataDir, gateway });
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	async function seedBoundMatches() {
		await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([
				{ artist: 'Aphex Twin', title: 'Xtal' },
				{ artist: 'Burial', title: 'Archangel' },
				{ artist: 'Unknown Artist', title: 'Missing From Catalog' }
			])
		});

		gateway.setCatalog([
			{ id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' },
			{ id: 'sc-arch-a', artist: 'Burial', title: 'Archangel' },
			{ id: 'sc-arch-b', artist: 'Burial', title: 'Archangel' },
			{ id: 'sc-search-hit', artist: 'Unknown Artist', title: 'Found By Hand' }
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
	}

	it('creates a dated Import Playlist, adds Auto + Accepted tracks, flags alreadyOnSc, and persists', async () => {
		await seedBoundMatches();

		const progress: Array<{ completed: number; total: number }> = [];
		const result = await api.writeImportPlaylist({
			paceMs: 0,
			now: new Date('2026-09-14T12:00:00.000Z'),
			onProgress: (event) => {
				progress.push({ completed: event.completed, total: event.total });
			}
		});

		expect(result.importPlaylist.title).toBe('VK import 2026-09-14');
		expect(result.importPlaylist.id).toBeTruthy();
		expect(result.writtenCount).toBe(2);
		expect(result.alreadyOnScCount).toBe(1);
		expect(result.session.importPlaylist).toEqual(result.importPlaylist);

		expect(gateway.calls.filter((name) => name === 'createPlaylist')).toEqual([
			'createPlaylist'
		]);
		expect(gateway.calls.filter((name) => name === 'listLikedTrackIds')).toEqual([
			'listLikedTrackIds'
		]);
		expect(gateway.calls.filter((name) => name === 'setPlaylistTracks')).toHaveLength(2);
		expect(gateway.playlistTrackIds(result.importPlaylist.id)).toEqual([
			'sc-xtal',
			'sc-arch-a'
		]);

		expect(progress).toEqual([
			{ completed: 1, total: 2 },
			{ completed: 2, total: 2 }
		]);

		const onDisk = await createSessionFileStore(dataDir).read();
		expect(onDisk?.importPlaylist).toEqual(result.importPlaylist);

		const xtal = onDisk?.matchRecords.find((r) => r.libraryTrack.title === 'Xtal');
		expect(xtal?.classification).toBe('auto');
		if (xtal?.classification === 'auto') {
			expect(xtal.alreadyOnSc).toBe(true);
			expect(xtal.soundCloudTrack.id).toBe('sc-xtal');
		}

		const burial = onDisk?.matchRecords.find((r) => r.libraryTrack.title === 'Archangel');
		expect(burial?.classification).toBe('accepted');
		if (burial?.classification === 'accepted') {
			expect(burial.alreadyOnSc).toBeUndefined();
			expect(burial.soundCloudTrack.id).toBe('sc-arch-a');
		}

		const unresolved = onDisk?.matchRecords.find(
			(r) => r.libraryTrack.title === 'Missing From Catalog'
		);
		expect(unresolved?.classification).toBe('unresolved');
		expect(unresolved && 'alreadyOnSc' in unresolved).toBe(false);
	});

	it('rejects write when SoundCloud is disconnected', async () => {
		await seedBoundMatches();
		await gateway.disconnect();

		await expect(api.writeImportPlaylist({ paceMs: 0 })).rejects.toThrow(/soundcloud/i);
	});

	it('rejects write when no bound Match Records exist', async () => {
		await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([{ artist: 'Unknown Artist', title: 'Missing From Catalog' }])
		});
		gateway.setCatalog([]);
		await api.runCatalogMatch();

		await expect(api.writeImportPlaylist({ paceMs: 0 })).rejects.toThrow(/bound/i);
	});

	it('idempotently reuses the Import Playlist on a second write (accidental double-start)', async () => {
		await seedBoundMatches();
		const first = await api.writeImportPlaylist({
			paceMs: 0,
			now: new Date('2026-09-14T12:00:00.000Z')
		});

		const second = await api.writeImportPlaylist({
			paceMs: 0,
			now: new Date('2026-09-15T12:00:00.000Z')
		});

		expect(second.importPlaylist.id).toBe(first.importPlaylist.id);
		expect(second.importPlaylist.title).toBe(first.importPlaylist.title);
		expect(second.session.importPlaylistWriteStatus).toBe('complete');
		expect(gateway.calls.filter((name) => name === 'createPlaylist')).toHaveLength(1);
		expect(gateway.playlistTrackIds(first.importPlaylist.id)).toEqual([
			'sc-xtal',
			'sc-arch-a'
		]);
	});

	it('keeps playlist identity on abort and resumes membership without creating a second playlist', async () => {
		await seedBoundMatches();
		const controller = new AbortController();
		let progressHits = 0;

		await expect(
			api.writeImportPlaylist({
				paceMs: 0,
				now: new Date('2026-09-14T12:00:00.000Z'),
				signal: controller.signal,
				onProgress: () => {
					progressHits += 1;
					if (progressHits === 1) {
						controller.abort();
					}
				}
			})
		).rejects.toMatchObject({ name: 'AbortError' });

		const mid = await createSessionFileStore(dataDir).read();
		expect(mid?.importPlaylist?.id).toBeTruthy();
		expect(mid?.importPlaylistWriteStatus).toBe('in_progress');
		expect(gateway.calls.filter((name) => name === 'createPlaylist')).toHaveLength(1);

		const resumed = await api.writeImportPlaylist({
			paceMs: 0,
			now: new Date('2026-09-14T12:00:00.000Z')
		});
		expect(resumed.importPlaylist.id).toBe(mid!.importPlaylist!.id);
		expect(resumed.session.importPlaylistWriteStatus).toBe('complete');
		expect(gateway.calls.filter((name) => name === 'createPlaylist')).toHaveLength(1);
		expect(gateway.playlistTrackIds(resumed.importPlaylist.id)).toEqual([
			'sc-xtal',
			'sc-arch-a'
		]);
	});
});
