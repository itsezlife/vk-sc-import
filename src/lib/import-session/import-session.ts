/**
 * Durable Import Session shape written to the Session File.
 *
 * Stores the validated Source Library and, after a Catalog Match pass, Match
 * Records. After Import Playlist write, stores Import Playlist identity and
 * `alreadyOnSc` flags on bound Match Records. Rematch mutates a bound Match
 * Record (and may refresh `alreadyOnSc`) while keeping the same Import
 * Playlist identity. Session File stores domain as a whole (no separate cache
 * DTO) — the file is our disk.
 *
 * Re-ingesting a Source Library replaces the session and clears Match Records
 * (and Import Playlist identity) so classifications never outlive their library
 * rows.
 */

import type { ImportPlaylist } from '$lib/soundcloud/import-playlist';
import type { LibraryTrack } from './library-track';
import type { MatchRecord } from './match-record';

export const SESSION_FILE_VERSION = 1 as const;

export type ImportSession = {
	version: typeof SESSION_FILE_VERSION;
	createdAt: string;
	updatedAt: string;
	libraryTracks: LibraryTrack[];
	/** Empty until the first Catalog Match pass; replaced on each full pass. */
	matchRecords: MatchRecord[];
	/** Set after the first successful Import Playlist write for this session. */
	importPlaylist?: ImportPlaylist;
};

export function createImportSession(
	libraryTracks: LibraryTrack[],
	now = new Date()
): ImportSession {
	const iso = now.toISOString();
	return {
		version: SESSION_FILE_VERSION,
		createdAt: iso,
		updatedAt: iso,
		libraryTracks,
		matchRecords: []
	};
}

/**
 * Returns a Session with Match Records from a Catalog Match pass and a fresh
 * `updatedAt`. Preserves `createdAt`, library rows, and Import Playlist when
 * present (resolve mutations reuse this helper). Full Catalog Match passes that
 * must drop a prior playlist call `withoutImportPlaylist` first.
 */
export function withMatchRecords(
	session: ImportSession,
	matchRecords: MatchRecord[],
	now = new Date()
): ImportSession {
	return {
		...session,
		updatedAt: now.toISOString(),
		matchRecords
	};
}

/** Drops Import Playlist identity (e.g. before a full Catalog Match pass). */
export function withoutImportPlaylist(session: ImportSession): ImportSession {
	const { importPlaylist: _drop, ...rest } = session;
	return rest;
}

/**
 * Returns a Session after Import Playlist write: playlist identity + Match
 * Records (with `alreadyOnSc` where detected). Preserves library rows and
 * `createdAt`.
 */
export function withImportPlaylistWrite(
	session: ImportSession,
	importPlaylist: ImportPlaylist,
	matchRecords: MatchRecord[],
	now = new Date()
): ImportSession {
	return {
		...session,
		updatedAt: now.toISOString(),
		matchRecords,
		importPlaylist
	};
}
