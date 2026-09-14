/**
 * Durable Import Session shape written to the Session File.
 *
 * Match Records and Import Playlist id arrive in later issues; this version only
 * stores the validated Source Library so reload restores library state. Session
 * File stores domain as a whole (no separate cache DTO) — the file is our disk.
 */

import type { LibraryTrack } from './library-track';

export const SESSION_FILE_VERSION = 1 as const;

export type ImportSession = {
	version: typeof SESSION_FILE_VERSION;
	createdAt: string;
	updatedAt: string;
	libraryTracks: LibraryTrack[];
};

export function createImportSession(libraryTracks: LibraryTrack[], now = new Date()): ImportSession {
	const iso = now.toISOString();
	return {
		version: SESSION_FILE_VERSION,
		createdAt: iso,
		updatedAt: iso,
		libraryTracks
	};
}
