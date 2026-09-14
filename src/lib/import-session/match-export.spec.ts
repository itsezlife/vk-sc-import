import { describe, expect, it } from 'vitest';
import type { MatchRecord } from './match-record';
import {
	buildMatchRecordsExport,
	buildUnresolvedExport,
	stringifyMatchExport
} from './match-export';

const records: MatchRecord[] = [
	{
		classification: 'auto',
		libraryTrack: { artist: 'Aphex Twin', title: 'Xtal' },
		soundCloudTrack: { id: 'sc-xtal', artist: 'Aphex Twin', title: 'Xtal' },
		confidence: 0.95,
		alreadyOnSc: true
	},
	{
		classification: 'ambiguous',
		libraryTrack: { artist: 'Burial', title: 'Archangel' },
		confidence: 0.6,
		candidates: [
			{ id: 'a', artist: 'Burial', title: 'Archangel' },
			{ id: 'b', artist: 'Burial', title: 'Archangel' }
		]
	},
	{
		classification: 'unresolved',
		libraryTrack: { artist: 'Unknown', title: 'Gap' },
		confidence: 0,
		deferred: true
	},
	{
		classification: 'unresolved',
		libraryTrack: { artist: 'Other', title: 'Also Missing' },
		confidence: 0.1
	}
];

describe('Match Record export', () => {
	it('exports only Unresolved rows with deferred flags', () => {
		const doc = buildUnresolvedExport(records, new Date('2026-09-14T12:00:00.000Z'));
		expect(doc).toEqual({
			version: 1,
			kind: 'unresolved',
			exportedAt: '2026-09-14T12:00:00.000Z',
			tracks: [
				{
					libraryTrack: { artist: 'Unknown', title: 'Gap' },
					confidence: 0,
					deferred: true
				},
				{
					libraryTrack: { artist: 'Other', title: 'Also Missing' },
					confidence: 0.1,
					deferred: false
				}
			]
		});
	});

	it('exports full Match Records with alreadyOnSc normalized to boolean', () => {
		const doc = buildMatchRecordsExport(records, new Date('2026-09-14T12:00:00.000Z'));
		expect(doc.kind).toBe('match-records');
		expect(doc.records).toHaveLength(4);
		expect(doc.records[0]).toMatchObject({
			classification: 'auto',
			alreadyOnSc: true
		});
		expect(doc.records[2]).toMatchObject({
			classification: 'unresolved',
			deferred: true
		});
	});

	it('stringifies as pretty JSON with trailing newline', () => {
		const text = stringifyMatchExport(
			buildUnresolvedExport([], new Date('2026-09-14T12:00:00.000Z'))
		);
		expect(text.endsWith('\n')).toBe(true);
		expect(JSON.parse(text).kind).toBe('unresolved');
	});
});
