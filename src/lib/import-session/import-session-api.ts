/**
 * Import Session API — the HTTP/JSON seam for library ingest and Session File I/O.
 *
 * Routes and seam tests share this contract. SoundCloud stays out: this API only
 * turns a Source Library into a persisted Import Session (or reports why not).
 *
 * Invariant: an ingest with zero valid Library Tracks does not create or replace
 * a Session File, so bad uploads cannot wipe a good session.
 */

import { createImportSession, type ImportSession } from './import-session';
import type { LibraryRowValidationError, LibraryTrack } from './library-track';
import { createSessionFileStore } from './session-file-store';
import {
	ingestSourceLibrary,
	type SourceLibraryFormat
} from './source-library-ingest';

const SAMPLE_SIZE = 5;

/** UI / HTTP summary of a loaded Import Session's library — not the Session File. */
export type ImportSessionSummary = {
	trackCount: number;
	sample: LibraryTrack[];
};

export type IngestLibraryRequest = {
	format: SourceLibraryFormat;
	content: string;
};

export type IngestLibraryResponse = {
	session: ImportSessionSummary | null;
	validationErrors: LibraryRowValidationError[];
};

export type GetSessionResponse = {
	session: ImportSessionSummary | null;
};

export type ImportSessionApi = {
	ingestLibrary(request: IngestLibraryRequest): Promise<IngestLibraryResponse>;
	getSession(): Promise<GetSessionResponse>;
};

export type CreateImportSessionApiOptions = {
	dataDir: string;
};

/**
 * Builds an Import Session API bound to one data directory (Session File root).
 */
export function createImportSessionApi(
	options: CreateImportSessionApiOptions
): ImportSessionApi {
	const store = createSessionFileStore(options.dataDir);

	return {
		async ingestLibrary(request) {
			const { tracks, validationErrors } = ingestSourceLibrary(
				request.format,
				request.content
			);

			if (tracks.length === 0) {
				return { session: null, validationErrors };
			}

			const session = createImportSession(tracks);
			await store.write(session);

			return {
				session: toSummary(session),
				validationErrors
			};
		},

		async getSession() {
			const session = await store.read();
			return { session: session ? toSummary(session) : null };
		}
	};
}

function toSummary(session: ImportSession): ImportSessionSummary {
	return {
		trackCount: session.libraryTracks.length,
		sample: session.libraryTracks.slice(0, SAMPLE_SIZE)
	};
}
