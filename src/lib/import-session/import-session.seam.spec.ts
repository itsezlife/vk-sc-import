import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createImportSessionApi } from './import-session-api';
import { createSessionFileStore } from './session-file-store';
import { ValidationCode } from './validation-code';

/**
 * Seam: Import Session HTTP/JSON contract (ingest + Session File round-trip).
 * No SoundCloud — library ingest and persistence only.
 */
describe('Import Session seam', () => {
	let dataDir: string;
	let api: ReturnType<typeof createImportSessionApi>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-import-session-'));
		api = createImportSessionApi({ dataDir });
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it('creates an Import Session from a JSON Source Library and reloads library state from the Session File', async () => {
		const content = JSON.stringify([
			{ artist: 'Aphex Twin', title: 'Xtal' },
			{ artist: 'Boards of Canada', title: 'Roygbiv' },
			{ artist: '', title: 'Missing Artist' },
			{ artist: 'Autechre', title: 'Fold4,Wrap5' }
		]);

		const ingest = await api.ingestLibrary({ format: 'json', content });

		expect(ingest.session).toEqual({
			trackCount: 3,
			sample: [
				{ artist: 'Aphex Twin', title: 'Xtal' },
				{ artist: 'Boards of Canada', title: 'Roygbiv' },
				{ artist: 'Autechre', title: 'Fold4,Wrap5' }
			]
		});
		expect(ingest.validationErrors).toEqual([
			{
				row: 3,
				message: ValidationCode.libraryTrackRequiresArtistTitle,
				artist: '',
				title: 'Missing Artist'
			}
		]);

		const reloaded = await api.getSession();
		expect(reloaded.session).toEqual(ingest.session);

		const onDisk = await createSessionFileStore(dataDir).read();
		expect(onDisk?.libraryTracks).toEqual([
			{ artist: 'Aphex Twin', title: 'Xtal' },
			{ artist: 'Boards of Canada', title: 'Roygbiv' },
			{ artist: 'Autechre', title: 'Fold4,Wrap5' }
		]);
	});

	it('accepts CSV Source Library rows and reports missing title without poisoning the session', async () => {
		const content = [
			'artist,title',
			'Burial,Archangel',
			'Four Tet,',
			'Floating Points,Silhouettes'
		].join('\n');

		const ingest = await api.ingestLibrary({ format: 'csv', content });

		expect(ingest.session?.trackCount).toBe(2);
		expect(ingest.session?.sample).toEqual([
			{ artist: 'Burial', title: 'Archangel' },
			{ artist: 'Floating Points', title: 'Silhouettes' }
		]);
		expect(ingest.validationErrors).toEqual([
			{
				row: 3,
				message: ValidationCode.libraryTrackRequiresArtistTitle,
				artist: 'Four Tet',
				title: ''
			}
		]);

		const reloaded = await api.getSession();
		expect(reloaded.session?.trackCount).toBe(2);
	});

	it('does not create or replace an Import Session when every row is invalid', async () => {
		const first = await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([{ artist: 'Keep', title: 'Me' }])
		});
		expect(first.session?.trackCount).toBe(1);

		const poisoned = await api.ingestLibrary({
			format: 'json',
			content: JSON.stringify([{ artist: '', title: '' }])
		});

		expect(poisoned.session).toBeNull();
		expect(poisoned.validationErrors).toHaveLength(1);

		const stillThere = await api.getSession();
		expect(stillThere.session?.trackCount).toBe(1);
		expect(stillThere.session?.sample).toEqual([{ artist: 'Keep', title: 'Me' }]);
	});

	it('returns null session when no Session File exists', async () => {
		const result = await api.getSession();
		expect(result.session).toBeNull();
	});
});
