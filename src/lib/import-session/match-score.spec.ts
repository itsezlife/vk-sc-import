/**
 * Pure Catalog Match normalize / score unit surface.
 *
 * Optional second surface from the spec: pins strict Auto-Match thresholds so
 * seam fixtures do not re-derive scoring. Not a product acceptance seam.
 */

import { describe, expect, it } from 'vitest';
import {
	AUTO_MIN_SCORE,
	AUTO_SCORE_MARGIN,
	classifyMatch,
	MIN_ACCEPT_SCORE,
	normalizeMatchText,
	scoreSoundCloudCandidate
} from './match-score';

describe('match-score (pure)', () => {
	it('normalizes case, punctuation, and featuring tags', () => {
		expect(normalizeMatchText('Aphex Twin')).toBe('aphex twin');
		expect(normalizeMatchText('Xtal (Remastered)')).toBe('xtal remastered');
		expect(normalizeMatchText('Artist feat. Guest')).toBe('artist guest');
		expect(normalizeMatchText('Artist ft. Guest')).toBe('artist guest');
	});

	it('scores an exact normalized artist+title as 1', () => {
		const score = scoreSoundCloudCandidate(
			{ artist: 'Aphex Twin', title: 'Xtal' },
			{ id: '1', artist: 'aphex twin', title: 'XTAL' }
		);
		expect(score).toBe(1);
	});

	it('classifies a clear winner as Auto-Match', () => {
		const record = classifyMatch(
			{ artist: 'Aphex Twin', title: 'Xtal' },
			[
				{
					track: { id: '1', artist: 'Aphex Twin', title: 'Xtal' },
					score: 1
				},
				{
					track: { id: '2', artist: 'Someone', title: 'Else' },
					score: MIN_ACCEPT_SCORE - 0.2
				}
			]
		);
		expect(record).toEqual({
			classification: 'auto',
			libraryTrack: { artist: 'Aphex Twin', title: 'Xtal' },
			soundCloudTrack: { id: '1', artist: 'Aphex Twin', title: 'Xtal' },
			confidence: 1
		});
	});

	it('classifies a close #1/#2 race as Ambiguous', () => {
		const top = AUTO_MIN_SCORE + 0.05;
		const record = classifyMatch(
			{ artist: 'Artist', title: 'Song' },
			[
				{
					track: { id: '1', artist: 'Artist', title: 'Song' },
					score: top
				},
				{
					track: { id: '2', artist: 'Artist', title: 'Song Remix' },
					score: top - AUTO_SCORE_MARGIN / 2
				}
			]
		);
		expect(record.classification).toBe('ambiguous');
		if (record.classification === 'ambiguous') {
			expect(record.candidates.map((c) => c.id)).toEqual(['1', '2']);
		}
	});

	it('classifies empty or weak catalog hits as Unresolved without candidates', () => {
		expect(classifyMatch({ artist: 'A', title: 'B' }, [])).toEqual({
			classification: 'unresolved',
			libraryTrack: { artist: 'A', title: 'B' },
			confidence: 0
		});
		const weak = classifyMatch(
			{ artist: 'A', title: 'B' },
			[
				{
					track: { id: '9', artist: 'Z', title: 'Q' },
					score: MIN_ACCEPT_SCORE - 0.1
				}
			]
		);
		expect(weak).toEqual({
			classification: 'unresolved',
			libraryTrack: { artist: 'A', title: 'B' },
			confidence: MIN_ACCEPT_SCORE - 0.1
		});
	});
});
