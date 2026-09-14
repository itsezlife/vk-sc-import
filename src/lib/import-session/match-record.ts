/**
 * Match Record — binding of one Library Track to a Catalog Match outcome.
 *
 * Closed leaf variants (Auto / Ambiguous / Unresolved) carry only the data
 * that variant means. Impossible combinations (Auto with unbound track,
 * Ambiguous with an accepted binding) are unrepresentable. `alreadyOnSc`
 * arrives with Import Playlist write (issue 06).
 */

import type { LibraryTrack } from './library-track';
import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

export type MatchRecord =
	| {
			classification: 'auto';
			libraryTrack: LibraryTrack;
			soundCloudTrack: SoundCloudTrack;
			confidence: number;
	  }
	| {
			classification: 'ambiguous';
			libraryTrack: LibraryTrack;
			confidence: number;
			candidates: SoundCloudTrack[];
	  }
	| {
			classification: 'unresolved';
			libraryTrack: LibraryTrack;
			confidence: number;
	  };

export type MatchBucketsSummary = {
	auto: number;
	ambiguous: number;
	unresolved: number;
};

export function summarizeMatchBuckets(records: MatchRecord[]): MatchBucketsSummary {
	const summary: MatchBucketsSummary = { auto: 0, ambiguous: 0, unresolved: 0 };
	for (const record of records) {
		summary[record.classification] += 1;
	}
	return summary;
}
