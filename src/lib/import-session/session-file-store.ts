/**
 * Session File persistence for one Import Session.
 *
 * Owns mkdir + write of session.json under a configured data dir. Writes go to a
 * sibling temp file then rename into place so a crash mid-write does not leave a
 * half-JSON Session File that would look like “no session” on reload.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	SESSION_FILE_VERSION,
	type ImportSession
} from './import-session';
import type { LibraryTrack } from './library-track';

export type SessionFileStore = {
	read(): Promise<ImportSession | null>;
	write(session: ImportSession): Promise<void>;
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
		libraryTracks.push({ artist, title });
	}

	return {
		version: SESSION_FILE_VERSION,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		libraryTracks
	};
}
