/**
 * Match Record — binding of one Library Track to a Catalog Match outcome.
 *
 * Owns: closed Match Record leaves, Match Resolution transforms (pick / bind /
 * skip), resolution queue order, bucket summary.
 *
 * Does not own: Catalog Match scoring, SoundCloud search I/O, Session File I/O,
 * Import Playlist write, UI copy.
 *
 * Closed leaf variants carry only the data that variant means:
 * - `auto` — strict Auto-Match (bound without review)
 * - `accepted` — user pick or search-bind (bound after Match Resolution)
 * - `ambiguous` — candidates pending listen / pick / search / skip
 * - `unresolved` — no accepted SoundCloud Track; optional `deferred` means the
 *   user skipped it for this pass so it does not block the resolution queue
 *
 * Impossible combinations (Auto unbound, Ambiguous with a binding, Accepted
 * without a track) are unrepresentable. `alreadyOnSc` arrives with Import
 * Playlist write (issue 06). Issue 06 writes both `auto` and `accepted`.
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
			classification: 'accepted';
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
			/**
			 * True after Match Resolution skip — still Unresolved for export /
			 * later revisit, but omitted from the active resolution queue so skip
			 * does not block the rest of the pass.
			 */
			deferred?: true;
	  };

export type MatchBucketsSummary = {
	auto: number;
	accepted: number;
	ambiguous: number;
	unresolved: number;
};

/** Ambiguous and Unresolved rows still waiting on Match Resolution. */
export type ResolutionQueueItem = {
	/** Index into Import Session `matchRecords` (stable for pick/bind/skip). */
	matchIndex: number;
	record: Extract<MatchRecord, { classification: 'ambiguous' | 'unresolved' }>;
};

export function summarizeMatchBuckets(records: MatchRecord[]): MatchBucketsSummary {
	const summary: MatchBucketsSummary = {
		auto: 0,
		accepted: 0,
		ambiguous: 0,
		unresolved: 0
	};
	for (const record of records) {
		summary[record.classification] += 1;
	}
	return summary;
}

/**
 * Ambiguous first (needs a choice among candidates), then Unresolved that the
 * user has not deferred via skip. Bound Auto/Accepted rows are not queued.
 */
export function buildResolutionQueue(records: MatchRecord[]): ResolutionQueueItem[] {
	const ambiguous: ResolutionQueueItem[] = [];
	const unresolved: ResolutionQueueItem[] = [];

	for (let matchIndex = 0; matchIndex < records.length; matchIndex += 1) {
		const record = records[matchIndex]!;
		if (record.classification === 'ambiguous') {
			ambiguous.push({ matchIndex, record });
		} else if (record.classification === 'unresolved' && !record.deferred) {
			unresolved.push({ matchIndex, record });
		}
	}

	return [...ambiguous, ...unresolved];
}

/**
 * User picked one Ambiguous candidate → Accepted Match Record.
 * Candidate must already be on the record; search-bind uses `acceptBoundTrack`.
 */
export function acceptCandidateRecord(
	record: Extract<MatchRecord, { classification: 'ambiguous' }>,
	soundCloudTrackId: string
): Extract<MatchRecord, { classification: 'accepted' }> {
	const soundCloudTrack = record.candidates.find((candidate) => candidate.id === soundCloudTrackId);
	if (!soundCloudTrack) {
		throw new Error(
			`SoundCloud Track ${soundCloudTrackId} is not a candidate on this Ambiguous Match`
		);
	}
	return {
		classification: 'accepted',
		libraryTrack: record.libraryTrack,
		soundCloudTrack,
		confidence: record.confidence
	};
}

/**
 * User attached a SoundCloud Track from in-app search (Ambiguous or Unresolved).
 * Confidence is 1 — the user asserted the binding, not the scorer.
 */
export function acceptBoundTrack(
	record: Extract<MatchRecord, { classification: 'ambiguous' | 'unresolved' }>,
	soundCloudTrack: SoundCloudTrack
): Extract<MatchRecord, { classification: 'accepted' }> {
	return {
		classification: 'accepted',
		libraryTrack: record.libraryTrack,
		soundCloudTrack,
		confidence: 1
	};
}

/**
 * Skip → Unresolved without blocking the queue.
 * Ambiguous becomes Unresolved deferred; Unresolved stays Unresolved deferred.
 * Deferred rows remain Unresolved in buckets/Session File but leave the active queue.
 */
export function skipMatchRecord(
	record: Extract<MatchRecord, { classification: 'ambiguous' | 'unresolved' }>
): Extract<MatchRecord, { classification: 'unresolved' }> {
	return {
		classification: 'unresolved',
		libraryTrack: record.libraryTrack,
		confidence: record.confidence,
		deferred: true
	};
}
