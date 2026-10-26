/**
 * Match Record — binding of one Library Track to a Catalog Match outcome.
 *
 * Owns: closed Match Record leaves, Match Resolution transforms (pick / bind /
 * skip / reopen), Rematch transform (replace bound SoundCloud Track), resolution /
 * review list builders, bucket summary.
 *
 * Does not own: Catalog Match scoring, SoundCloud search I/O, Session File I/O,
 * Import Playlist write / membership HTTP, UI copy.
 *
 * Closed leaf variants carry only the data that variant means:
 * - `auto` — strict Auto-Match (bound without review)
 * - `accepted` — user pick, search-bind, or Rematch (bound after user action)
 * - `ambiguous` — candidates pending listen / pick / search / skip
 * - `unresolved` — no accepted SoundCloud Track; optional `deferred` means the
 *   user skipped it for this pass so it does not block the resolution queue
 *
 * Impossible combinations (Auto unbound, Ambiguous with a binding, Accepted
 * without a track) are unrepresentable. Bound leaves may carry `alreadyOnSc`
 * after Import Playlist write (or Rematch) when the SoundCloud Track was
 * already liked on the account — the track is still added to the Import
 * Playlist. Issue 06 writes both `auto` and `accepted`; Rematch always lands
 * on `accepted` because the user asserted the new binding.
 */

import type { LibraryTrack } from './library-track';
import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

export type MatchRecord =
	| {
			classification: 'auto';
			libraryTrack: LibraryTrack;
			soundCloudTrack: SoundCloudTrack;
			confidence: number;
			/**
			 * True after Import Playlist write when this SoundCloud Track was
			 * already present on the user’s SoundCloud likes. Omitted otherwise.
			 */
			alreadyOnSc?: true;
	  }
	| {
			classification: 'accepted';
			libraryTrack: LibraryTrack;
			soundCloudTrack: SoundCloudTrack;
			confidence: number;
			/**
			 * True after Import Playlist write when this SoundCloud Track was
			 * already present on the user’s SoundCloud likes. Omitted otherwise.
			 */
			alreadyOnSc?: true;
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

/**
 * Rows the user already decided in Match Resolution: Accepted (pick / bind /
 * Rematch) and skipped (deferred Unresolved). Auto-Match is not listed — the
 * user never decided it, and Rematch already covers changing it.
 */
export type DecidedListItem = {
	/** Index into Import Session `matchRecords` (stable for reopen). */
	matchIndex: number;
	record:
		| Extract<MatchRecord, { classification: 'accepted' }>
		| Extract<MatchRecord, { classification: 'unresolved'; deferred?: true }>;
};

/** Bound Auto/Accepted rows available for post-write review and Rematch. */
export type ReviewListItem = {
	/** Index into Import Session `matchRecords` (stable for Rematch). */
	matchIndex: number;
	record: Extract<MatchRecord, { classification: 'auto' | 'accepted' }>;
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

/**
 * Accepted + skipped rows, most recently decided first — the Decided list.
 *
 * Match Records carry no decision time; `history` (Session File undo stack,
 * oldest first) is the only record of decision order. Rows it covers lead,
 * newest first; rows decided before history existed follow in reverse
 * library order — the queue walks the library top-down, so that is the best
 * remaining guess.
 */
export function buildDecidedList(
	records: MatchRecord[],
	history: ResolutionQueueItem[] = []
): DecidedListItem[] {
	const decidedAt = (matchIndex: number): DecidedListItem | null => {
		const record = records[matchIndex];
		if (
			record &&
			(record.classification === 'accepted' ||
				(record.classification === 'unresolved' && record.deferred === true))
		) {
			return { matchIndex, record };
		}
		return null;
	};

	const items: DecidedListItem[] = [];
	const listed = new Set<number>();
	for (let at = history.length - 1; at >= 0; at -= 1) {
		const { matchIndex } = history[at]!;
		const item = listed.has(matchIndex) ? null : decidedAt(matchIndex);
		if (item) {
			items.push(item);
			listed.add(matchIndex);
		}
	}
	for (let matchIndex = records.length - 1; matchIndex >= 0; matchIndex -= 1) {
		const item = listed.has(matchIndex) ? null : decidedAt(matchIndex);
		if (item) {
			items.push(item);
		}
	}
	return items;
}

/**
 * Reopen a decided row that has no history entry (decided before history
 * existed, or the entry was already used). The candidates are gone, so an
 * Accepted row comes back as Unresolved: Match Resolution's seed search then
 * finds fresh options. A skipped row just loses `deferred`.
 */
export function reopenDecidedRecord(
	current: DecidedListItem['record']
): Extract<MatchRecord, { classification: 'unresolved' }> {
	return {
		classification: 'unresolved',
		libraryTrack: current.libraryTrack,
		confidence: current.confidence
	};
}

/**
 * Reopen — undo one Match Resolution decision (pick / bind / skip).
 *
 * `previous` is the Session File history entry for that row. It is only
 * restored when `current` is still what a decision produces (Accepted, or
 * deferred Unresolved) for the same Library Track — a history entry that went
 * stale (e.g. Rematch since) must not overwrite a different binding.
 */
export function reopenMatchRecord(
	current: MatchRecord,
	previous: ResolutionQueueItem['record']
): ResolutionQueueItem['record'] {
	const decided =
		current.classification === 'accepted' ||
		(current.classification === 'unresolved' && current.deferred === true);
	if (!decided) {
		throw new Error(
			`Match Record is ${current.classification}, not a Match Resolution decision to reopen`
		);
	}
	if (
		current.libraryTrack.artist !== previous.libraryTrack.artist ||
		current.libraryTrack.title !== previous.libraryTrack.title
	) {
		throw new Error('Reopen Library Track does not match the Match Record at that index');
	}
	if (previous.classification === 'ambiguous') {
		return previous;
	}
	// Back in the active queue: a deferred flag here would hide it again.
	return {
		classification: 'unresolved',
		libraryTrack: previous.libraryTrack,
		confidence: previous.confidence
	};
}

/**
 * Bound Auto + Accepted in Session File order — post-write review list.
 * Ambiguous / Unresolved have no SoundCloud Track pair to audit.
 */
export function buildReviewList(records: MatchRecord[]): ReviewListItem[] {
	const items: ReviewListItem[] = [];
	for (let matchIndex = 0; matchIndex < records.length; matchIndex += 1) {
		const record = records[matchIndex]!;
		if (record.classification === 'auto' || record.classification === 'accepted') {
			items.push({ matchIndex, record });
		}
	}
	return items;
}

/**
 * Rematch — replace the SoundCloud Track on a bound Match Record.
 *
 * Always becomes `accepted` with confidence 1: the user asserted the binding,
 * whether the prior leaf was Auto or Accepted. `alreadyOnSc` is set only when
 * the caller knows the new track is liked; omitted otherwise (clears a stale
 * flag from the previous binding).
 */
export function rematchBoundTrack(
	record: Extract<MatchRecord, { classification: 'auto' | 'accepted' }>,
	soundCloudTrack: SoundCloudTrack,
	alreadyOnSc?: boolean
): Extract<MatchRecord, { classification: 'accepted' }> {
	return {
		classification: 'accepted',
		libraryTrack: record.libraryTrack,
		soundCloudTrack,
		confidence: 1,
		...(alreadyOnSc === true ? { alreadyOnSc: true as const } : {})
	};
}

/**
 * Ordered SoundCloud Track ids for bound Match Records — Import Playlist
 * membership rebuild after Rematch (Session order, same as write).
 */
export function boundPlaylistTrackIds(records: MatchRecord[]): string[] {
	const ids: string[] = [];
	for (const record of records) {
		if (record.classification === 'auto' || record.classification === 'accepted') {
			ids.push(record.soundCloudTrack.id);
		}
	}
	return ids;
}
