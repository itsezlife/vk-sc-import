import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeSoundCloudGateway } from '$lib/soundcloud/fake-soundcloud-gateway';
import { createImportSessionApi } from './import-session-api';
import { createSessionFileStore } from './session-file-store';

/**
 * Seam: Import Session Catalog Match (search + classify + Session File).
 * Fake SoundCloudGateway catalog — no live network.
 */
describe('Import Session Catalog Match seam', () => {
	let dataDir: string;
	let gateway: ReturnType<typeof createFakeSoundCloudGateway>;
	let api: ReturnType<typeof createImportSessionApi>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-import-match-'));
		gateway = createFakeSoundCloudGateway();
		gateway.connectAs({ id: 'u1', username: 'matcher' });
		api = createImportSessionApi({ dataDir, gateway });
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	async function loadLibrary() {
		await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([
				{ artist: 'Aphex Twin', title: 'Xtal' },
				{ artist: 'Burial', title: 'Archangel' },
				{ artist: 'Unknown Artist', title: 'Missing From Catalog' }
			])
		});
	}

	it('classifies Auto / Ambiguous / Unresolved from a fake catalog and persists Match Records', async () => {
		await loadLibrary();

		// Two exact Burial/Archangel catalog rows → tied top scores → Ambiguous.
		// Single Aphex Twin/Xtal hit → Auto. Missing query → Unresolved.
		gateway.setCatalog([
			{ id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' },
			{ id: 'sc-arch-a', artist: 'Burial', title: 'Archangel' },
			{ id: 'sc-arch-b', artist: 'Burial', title: 'Archangel' }
		]);

		const progress: Array<{ completed: number; total: number }> = [];
		const result = await api.runCatalogMatch({
			onProgress: (event) => {
				progress.push({ completed: event.completed, total: event.total });
			}
		});

		expect(result.matchBuckets).toEqual({
			auto: 1,
			accepted: 0,
			ambiguous: 1,
			unresolved: 1
		});
		expect(result.session.matchBuckets).toEqual(result.matchBuckets);
		expect(result.session.trackCount).toBe(3);

		expect(progress.length).toBe(3);
		expect(progress[0]).toEqual({ completed: 1, total: 3 });
		expect(progress[2]).toEqual({ completed: 3, total: 3 });

		const onDisk = await createSessionFileStore(dataDir).read();
		expect(onDisk?.matchRecords).toHaveLength(3);

		const byTitle = Object.fromEntries(
			(onDisk?.matchRecords ?? []).map((record) => [
				record.libraryTrack.title,
				record.classification
			])
		);
		expect(byTitle).toEqual({
			Xtal: 'auto',
			Archangel: 'ambiguous',
			'Missing From Catalog': 'unresolved'
		});

		const auto = onDisk?.matchRecords.find((r) => r.classification === 'auto');
		expect(auto?.classification === 'auto' && auto.soundCloudTrack.id).toBe('sc-xtal');

		const ambiguous = onDisk?.matchRecords.find((r) => r.classification === 'ambiguous');
		expect(ambiguous?.classification).toBe('ambiguous');
		if (ambiguous?.classification === 'ambiguous') {
			expect(ambiguous.candidates.map((c) => c.id).sort()).toEqual([
				'sc-arch-a',
				'sc-arch-b'
			]);
		}

		const unresolved = onDisk?.matchRecords.find(
			(r) => r.classification === 'unresolved'
		);
		expect(unresolved?.classification).toBe('unresolved');
		expect(unresolved && 'soundCloudTrack' in unresolved).toBe(false);
		expect(gateway.calls.filter((name) => name === 'searchTracks')).toHaveLength(3);

		const reloaded = await api.getSession();
		expect(reloaded.session?.matchBuckets).toEqual({
			auto: 1,
			accepted: 0,
			ambiguous: 1,
			unresolved: 1
		});
	});

	it('rejects Catalog Match when SoundCloud is disconnected', async () => {
		await loadLibrary();
		await gateway.disconnect();

		await expect(api.runCatalogMatch()).rejects.toThrow(/soundcloud/i);
	});

	it('rejects Catalog Match when no Import Session exists', async () => {
		await expect(api.runCatalogMatch()).rejects.toThrow(/session/i);
	});

	it('persists Match Records as they complete and resumes after abort', async () => {
		await loadLibrary();
		gateway.setCatalog([
			{ id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' },
			{ id: 'sc-arch-a', artist: 'Burial', title: 'Archangel' },
			{ id: 'sc-arch-b', artist: 'Burial', title: 'Archangel' }
		]);

		const controller = new AbortController();
		await expect(
			api.runCatalogMatch({
				paceMs: 0,
				signal: controller.signal,
				onProgress: (event) => {
					if (event.completed === 1) {
						controller.abort();
					}
				}
			})
		).rejects.toMatchObject({ name: 'AbortError' });

		const mid = await createSessionFileStore(dataDir).read();
		expect(mid?.matchRecords).toHaveLength(1);
		expect(mid?.matchRecords[0]?.libraryTrack.title).toBe('Xtal');

		const searchesBeforeResume = gateway.calls.filter((name) => name === 'searchTracks').length;
		expect(searchesBeforeResume).toBe(1);

		const result = await api.runCatalogMatch({ paceMs: 0 });
		expect(result.matchBuckets).toEqual({
			auto: 1,
			accepted: 0,
			ambiguous: 1,
			unresolved: 1
		});
		expect(result.session.matchedCount).toBe(3);

		const searchesAfterResume = gateway.calls.filter((name) => name === 'searchTracks').length;
		expect(searchesAfterResume).toBe(3);

		const onDisk = await createSessionFileStore(dataDir).read();
		expect(onDisk?.matchRecords).toHaveLength(3);
	});

	it('exports Unresolved and full Match Records without mutating the Session File', async () => {
		await loadLibrary();
		gateway.setCatalog([
			{ id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' },
			{ id: 'sc-arch-a', artist: 'Burial', title: 'Archangel' },
			{ id: 'sc-arch-b', artist: 'Burial', title: 'Archangel' }
		]);
		await api.runCatalogMatch({ paceMs: 0 });

		const before = await createSessionFileStore(dataDir).read();
		const unresolved = await api.exportUnresolved(new Date('2026-09-14T12:00:00.000Z'));
		const full = await api.exportMatchRecords(new Date('2026-09-14T12:00:00.000Z'));

		expect(unresolved.document.kind).toBe('unresolved');
		expect(unresolved.document.tracks).toHaveLength(1);
		expect(unresolved.filename).toBe('unresolved-tracks.json');
		expect(JSON.parse(unresolved.body).tracks[0].libraryTrack.title).toBe(
			'Missing From Catalog'
		);

		expect(full.document.kind).toBe('match-records');
		expect(full.document.records).toHaveLength(3);
		expect(full.filename).toBe('match-records.json');

		const after = await createSessionFileStore(dataDir).read();
		expect(after).toEqual(before);
	});
});
