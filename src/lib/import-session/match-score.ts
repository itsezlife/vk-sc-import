/**
 * Pure Catalog Match normalize / score / classify.
 *
 * Owns the strict Auto-Match policy: normalized artist+title must clearly
 * prefer candidate #1 over #2. I/O-free so seam fixtures stay small and unit
 * tests can pin thresholds without a fake gateway.
 *
 * Does not own: SoundCloud search, Session File, progress, already-on-SC.
 */

import type { LibraryTrack } from './library-track';
import type { MatchRecord } from './match-record';
import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

/** Below this, a hit is ignored for Ambiguous/Auto. */
export const MIN_ACCEPT_SCORE = 0.55;

/** Absolute floor for Auto-Match on the winning candidate. */
export const AUTO_MIN_SCORE = 0.82;

/**
 * Winner must beat the next scored catalog hit by at least this margin for
 * Auto-Match (including hits below MIN_ACCEPT_SCORE — a near-miss runner-up
 * still blocks Auto). Without a second hit, only AUTO_MIN_SCORE applies.
 */
export const AUTO_SCORE_MARGIN = 0.12;

/** Max candidates retained on an Ambiguous Match Record. */
export const AMBIGUOUS_CANDIDATE_LIMIT = 5;

export type ScoredCandidate = {
	track: SoundCloudTrack;
	score: number;
};

/**
 * Canonical Catalog Match key: lowercase, strip diacritics/punct, collapse
 * space, drop common feat./ft./featuring tags so VK vs SC labeling noise does
 * not block an otherwise exact hit.
 */
export function normalizeMatchText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/\b(feat\.?|ft\.?|featuring)\b/g, ' ')
		.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function libraryTrackQuery(track: LibraryTrack): string {
	return `${track.artist} ${track.title}`.trim();
}

/**
 * Score one SoundCloud Track against a Library Track in [0, 1].
 *
 * Exact normalized artist+title → 1. Combined Jaccard on tokens, with a
 * stronger weight when both artist and title tokens overlap independently —
 * avoids Auto-Match when only the title matches a popular name.
 */
export function scoreSoundCloudCandidate(
	libraryTrack: LibraryTrack,
	candidate: SoundCloudTrack
): number {
	const libArtist = normalizeMatchText(libraryTrack.artist);
	const libTitle = normalizeMatchText(libraryTrack.title);
	const candArtist = normalizeMatchText(candidate.artist);
	const candTitle = normalizeMatchText(candidate.title);

	if (!libArtist || !libTitle || !candArtist || !candTitle) {
		return 0;
	}

	if (libArtist === candArtist && libTitle === candTitle) {
		return 1;
	}

	const artistScore = tokenJaccard(libArtist, candArtist);
	const titleScore = tokenJaccard(libTitle, candTitle);
	const combinedScore = tokenJaccard(`${libArtist} ${libTitle}`, `${candArtist} ${candTitle}`);

	// Prefer balanced artist+title agreement over a single-field coincidence.
	return clamp01(0.45 * artistScore + 0.45 * titleScore + 0.1 * combinedScore);
}

/**
 * Classify ranked scored candidates into a Match Record under the strict
 * Auto-Match policy.
 */
export function classifyMatch(
	libraryTrack: LibraryTrack,
	scored: ScoredCandidate[]
): MatchRecord {
	const ranked = [...scored].sort((a, b) => b.score - a.score);
	const accepted = ranked.filter((row) => row.score >= MIN_ACCEPT_SCORE);
	const best = accepted[0];

	if (!best) {
		return {
			classification: 'unresolved',
			libraryTrack,
			confidence: ranked[0]?.score ?? 0
		};
	}

	const runnerUp = ranked[1];
	const clearWinner =
		best.score >= AUTO_MIN_SCORE &&
		(runnerUp === undefined || best.score - runnerUp.score >= AUTO_SCORE_MARGIN);

	if (clearWinner) {
		return {
			classification: 'auto',
			libraryTrack,
			soundCloudTrack: best.track,
			confidence: best.score
		};
	}

	return {
		classification: 'ambiguous',
		libraryTrack,
		confidence: best.score,
		candidates: accepted.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).map((row) => row.track)
	};
}

function tokenJaccard(a: string, b: string): number {
	const left = new Set(a.split(' ').filter(Boolean));
	const right = new Set(b.split(' ').filter(Boolean));
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) {
			intersection += 1;
		}
	}
	const union = left.size + right.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function clamp01(value: number): number {
	if (value < 0) {
		return 0;
	}
	if (value > 1) {
		return 1;
	}
	return value;
}
