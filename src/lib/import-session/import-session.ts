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
 * Catalog Match may leave a shorter `matchRecords` array than `libraryTracks`
 * when a paced pass is cancelled mid-run — that incomplete prefix is valid
 * progress and the next pass resumes from its length. A fresh full pass
 * (complete prior records, or empty) replaces Match Records and clears
 * Import Playlist identity.
 *
 * Import Playlist write may leave `importPlaylistWriteStatus: 'in_progress'`
 * after create / partial membership when cancelled; resume reuses the same
 * playlist id. Legacy Session Files with `importPlaylist` and no status field
 * read as `complete`.
 *
 * Re-ingesting a Source Library replaces the session and clears Match Records
 * (and Import Playlist identity) so classifications never outlive their library
 * rows.
 */

import type { ImportPlaylist } from '$lib/soundcloud/import-playlist';
import type { LibraryTrack } from './library-track';
import type { MatchRecord } from './match-record';

export const SESSION_FILE_VERSION = 1 as const;

/** Membership write lifecycle for the Session File Import Playlist identity. */
export type ImportPlaylistWriteStatus = 'in_progress' | 'complete';

export type ImportSession = {
	version: typeof SESSION_FILE_VERSION;
	createdAt: string;
	updatedAt: string;
	libraryTracks: LibraryTrack[];
	/**
	 * Empty until Catalog Match writes at least one row. May be a cancelled
	 * prefix (`length < libraryTracks.length`) or a full 1:1 pass.
	 */
	matchRecords: MatchRecord[];
	/** Set once Import Playlist create succeeds (including mid-write cancel). */
	importPlaylist?: ImportPlaylist;
	/**
	 * Present with `importPlaylist`. Omitted on legacy complete Session Files
	 * (treated as `complete` when reading).
	 */
	importPlaylistWriteStatus?: ImportPlaylistWriteStatus;
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

/** Drops Import Playlist identity and write status (e.g. before a fresh Catalog Match pass). */
export function withoutImportPlaylist(session: ImportSession): ImportSession {
	const {
		importPlaylist: _dropPlaylist,
		importPlaylistWriteStatus: _dropStatus,
		...rest
	} = session;
	return rest;
}

/**
 * Returns a Session after Import Playlist create / paced membership step /
 * completion: playlist identity + Match Records (with `alreadyOnSc` where
 * detected) + write status. Preserves library rows and `createdAt`.
 */
export function withImportPlaylistWrite(
	session: ImportSession,
	importPlaylist: ImportPlaylist,
	matchRecords: MatchRecord[],
	writeStatus: ImportPlaylistWriteStatus,
	now = new Date()
): ImportSession {
	return {
		...session,
		updatedAt: now.toISOString(),
		matchRecords,
		importPlaylist,
		importPlaylistWriteStatus: writeStatus
	};
}

/**
 * Whether Import Playlist membership write finished for this session.
 * Legacy files with playlist identity and no status field count as complete.
 */
export function isImportPlaylistWriteComplete(session: ImportSession): boolean {
	if (!session.importPlaylist) {
		return false;
	}
	if (session.importPlaylistWriteStatus === undefined) {
		return true;
	}
	return session.importPlaylistWriteStatus === 'complete';
}
