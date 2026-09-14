/**
 * Session File persistence for one Import Session.
 *
 * Owns mkdir + write of session.json under a configured data dir. Writes go to a
 * sibling temp file then rename into place so a crash mid-write does not leave a
 * half-JSON Session File that would look like “no session” on reload.
 *
 * Match Records are optional on disk for sessions written before Catalog Match;
 * missing `matchRecords` reads as `[]`. Import Playlist and `alreadyOnSc` are
 * optional for sessions written before Import Playlist write.
 * `importPlaylistWriteStatus` is optional; a legacy Session File with
 * `importPlaylist` and no status reads as a completed write.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	parseImportPlaylist,
	type ImportPlaylist
} from '$lib/soundcloud/import-playlist';
import {
	SESSION_FILE_VERSION,
	type ImportPlaylistWriteStatus,
	type ImportSession
} from './import-session';
import type { LibraryTrack } from './library-track';
import type { MatchRecord } from './match-record';
import { parseSoundCloudTrack, type SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

export type SessionFileStore = {
	read(): Promise<ImportSession | null>;
	write(session: ImportSession): Promise<void>;
	/** Removes the Session File so reload is “no Import Session”. Idempotent. */
	clear(): Promise<void>;
};

export function createSessionFileStore(dataDir: string): SessionFileStore {
	const filePath = join(dataDir, 'session.json');

	return {
		async read() {
			let raw: string;
			try {
				raw = await readFile(filePath, 'utf8');
			} catch (error) {
				if (isNotFound(error)) {
					return null;
				}
				throw error;
			}

			const session = parseSessionFile(raw);
			if (session === null) {
				console.error(
					`[session-file-store] Session File at ${filePath} is unreadable or invalid; treating as no session`
				);
			}
			return session;
		},

		async write(session) {
			await mkdir(dirname(filePath), { recursive: true });
			const tempPath = `${filePath}.${process.pid}.tmp`;
			await writeFile(tempPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
			await rename(tempPath, filePath);
		},

		async clear() {
			try {
				await unlink(filePath);
			} catch (error) {
				if (!isNotFound(error)) {
					throw error;
				}
			}
		}
	};
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 'ENOENT'
	);
}

function parseSessionFile(raw: string): ImportSession | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (parsed === null || typeof parsed !== 'object') {
		return null;
	}

	const record = parsed as Record<string, unknown>;
	if (record.version !== SESSION_FILE_VERSION) {
		return null;
	}
	if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') {
		return null;
	}
	if (!Array.isArray(record.libraryTracks)) {
		return null;
	}

	const libraryTracks: LibraryTrack[] = [];
	for (const row of record.libraryTracks) {
		const track = parseLibraryTrack(row);
		if (track === null) {
			return null;
		}
		libraryTracks.push(track);
	}

	let matchRecords: MatchRecord[] = [];
	if (record.matchRecords !== undefined) {
		if (!Array.isArray(record.matchRecords)) {
			return null;
		}
		matchRecords = [];
		for (const row of record.matchRecords) {
			const matchRecord = parseMatchRecord(row);
			if (matchRecord === null) {
				return null;
			}
			matchRecords.push(matchRecord);
		}
	}

	let importPlaylist: ImportPlaylist | undefined;
	if (record.importPlaylist !== undefined) {
		const parsed = parseImportPlaylist(record.importPlaylist);
		if (parsed === null) {
			return null;
		}
		importPlaylist = parsed;
	}

	let importPlaylistWriteStatus: ImportPlaylistWriteStatus | undefined;
	if (record.importPlaylistWriteStatus !== undefined) {
		if (
			record.importPlaylistWriteStatus !== 'in_progress' &&
			record.importPlaylistWriteStatus !== 'complete'
		) {
			return null;
		}
		importPlaylistWriteStatus = record.importPlaylistWriteStatus;
	}

	return {
		version: SESSION_FILE_VERSION,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		libraryTracks,
		matchRecords,
		...(importPlaylist ? { importPlaylist } : {}),
		...(importPlaylistWriteStatus ? { importPlaylistWriteStatus } : {})
	};
}

function parseLibraryTrack(row: unknown): LibraryTrack | null {
	if (row === null || typeof row !== 'object') {
		return null;
	}
	const artist = (row as { artist?: unknown }).artist;
	const title = (row as { title?: unknown }).title;
	if (typeof artist !== 'string' || typeof title !== 'string') {
		return null;
	}
	if (!artist.trim() || !title.trim()) {
		return null;
	}
	return { artist, title };
}

function parseMatchRecord(row: unknown): MatchRecord | null {
	if (row === null || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	const libraryTrack = parseLibraryTrack(record.libraryTrack);
	if (libraryTrack === null) {
		return null;
	}
	if (typeof record.confidence !== 'number' || Number.isNaN(record.confidence)) {
		return null;
	}

	if (record.classification === 'auto' || record.classification === 'accepted') {
		const soundCloudTrack = parseSoundCloudTrack(record.soundCloudTrack);
		if (soundCloudTrack === null) {
			return null;
		}
		const alreadyOnSc = record.alreadyOnSc;
		if (alreadyOnSc !== undefined && alreadyOnSc !== true) {
			return null;
		}
		return {
			classification: record.classification,
			libraryTrack,
			soundCloudTrack,
			confidence: record.confidence,
			...(alreadyOnSc === true ? { alreadyOnSc: true as const } : {})
		};
	}

	if (record.classification === 'ambiguous') {
		if (!Array.isArray(record.candidates) || record.candidates.length === 0) {
			return null;
		}
		const candidates: SoundCloudTrack[] = [];
		for (const candidate of record.candidates) {
			const track = parseSoundCloudTrack(candidate);
			if (track === null) {
				return null;
			}
			candidates.push(track);
		}
		return {
			classification: 'ambiguous',
			libraryTrack,
			confidence: record.confidence,
			candidates
		};
	}

	if (record.classification === 'unresolved') {
		const deferred = record.deferred;
		if (deferred !== undefined && deferred !== true) {
			return null;
		}
		return {
			classification: 'unresolved',
			libraryTrack,
			confidence: record.confidence,
			...(deferred === true ? { deferred: true as const } : {})
		};
	}

	return null;
}
