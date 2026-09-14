/**
 * Durable Import Session shape written to the Session File.
 *
 * Stores the validated Source Library and, after a Catalog Match pass, Match
 * Records. Import Playlist id arrives in a later issue. Session File stores
 * domain as a whole (no separate cache DTO) — the file is our disk.
 *
 * Re-ingesting a Source Library replaces the session and clears Match Records
 * so classifications never outlive their library rows.
 */

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
 * `updatedAt`. Preserves `createdAt` and library rows.
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
