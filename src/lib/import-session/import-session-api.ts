/**
 * Import Session API — the HTTP/JSON seam for library ingest, Catalog Match,
 * and Session File I/O.
 *
 * Routes and seam tests share this contract. Catalog Match searches through
 * SoundCloudGateway and classifies with the pure strict Auto-Match policy;
 * results land in the Session File as Match Records.
 *
 * Invariants:
 * - An ingest with zero valid Library Tracks does not create or replace a
 *   Session File, so bad uploads cannot wipe a good session.
 * - Re-ingest replaces library rows and clears Match Records.
 * - `runCatalogMatch` requires a loaded session and a connected SoundCloud
 *   identity; it replaces Match Records for the full library on each pass.
 */

import {
	createImportSession,
	withMatchRecords,
	type ImportSession
} from './import-session';
import type { LibraryRowValidationError, LibraryTrack } from './library-track';
import {
	summarizeMatchBuckets,
	type MatchBucketsSummary
} from './match-record';
import {
	classifyMatch,
	libraryTrackQuery,
	scoreSoundCloudCandidate
} from './match-score';
import { createSessionFileStore } from './session-file-store';
import {
	ingestSourceLibrary,
	type SourceLibraryFormat
} from './source-library-ingest';
import type { SoundCloudGateway } from '$lib/soundcloud/soundcloud-gateway';

const SAMPLE_SIZE = 5;

/** UI / HTTP summary of a loaded Import Session — not the Session File. */
export type ImportSessionSummary = {
	trackCount: number;
	sample: LibraryTrack[];
	/** Null until at least one Catalog Match pass wrote Match Records. */
	matchBuckets: MatchBucketsSummary | null;
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

export type CatalogMatchProgress = {
	completed: number;
	total: number;
	current: LibraryTrack;
};

export type RunCatalogMatchOptions = {
	onProgress?: (progress: CatalogMatchProgress) => void;
};

export type CatalogMatchResponse = {
	session: ImportSessionSummary;
	matchBuckets: MatchBucketsSummary;
};

export type ImportSessionApi = {
	ingestLibrary(request: IngestLibraryRequest): Promise<IngestLibraryResponse>;
	getSession(): Promise<GetSessionResponse>;
	runCatalogMatch(options?: RunCatalogMatchOptions): Promise<CatalogMatchResponse>;
};

export type CreateImportSessionApiOptions = {
	dataDir: string;
	/**
	 * Required for Catalog Match. Ingest/getSession work without it, but
	 * `runCatalogMatch` throws if gateway is missing or disconnected.
	 */
	gateway?: SoundCloudGateway;
};

/**
 * Builds an Import Session API bound to one data directory (Session File root)
 * and an optional SoundCloudGateway for Catalog Match.
 */
export function createImportSessionApi(
	options: CreateImportSessionApiOptions
): ImportSessionApi {
	const store = createSessionFileStore(options.dataDir);
	const gateway = options.gateway;

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
		},

		async runCatalogMatch(matchOptions) {
			if (!gateway) {
				throw new Error('Catalog Match requires a SoundCloudGateway');
			}

			const identity = await gateway.getIdentity();
			if (!identity) {
				throw new Error('Catalog Match requires a connected SoundCloud account');
			}

			const session = await store.read();
			if (!session || session.libraryTracks.length === 0) {
				throw new Error('Catalog Match requires a loaded Import Session');
			}

			const total = session.libraryTracks.length;
			const matchRecords = [];

			for (let index = 0; index < total; index += 1) {
				const libraryTrack = session.libraryTracks[index]!;
				const hits = await gateway.searchTracks(libraryTrackQuery(libraryTrack));
				const scored = hits.map((track) => ({
					track,
					score: scoreSoundCloudCandidate(libraryTrack, track)
				}));
				const record = classifyMatch(libraryTrack, scored);
				matchRecords.push(record);

				matchOptions?.onProgress?.({
					completed: index + 1,
					total,
					current: libraryTrack
				});
			}

			const next = withMatchRecords(session, matchRecords);
			await store.write(next);

			const matchBuckets = summarizeMatchBuckets(matchRecords);
			return {
				session: toSummary(next),
				matchBuckets
			};
		}
	};
}

function toSummary(session: ImportSession): ImportSessionSummary {
	const matchBuckets =
		session.matchRecords.length > 0
			? summarizeMatchBuckets(session.matchRecords)
			: null;

	return {
		trackCount: session.libraryTracks.length,
		sample: session.libraryTracks.slice(0, SAMPLE_SIZE),
		matchBuckets
	};
}
