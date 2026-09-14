/**
 * Import Session API — the HTTP/JSON seam for library ingest, Catalog Match,
 * Match Resolution, and Session File I/O.
 *
 * Routes and seam tests share this contract. Catalog Match searches through
 * SoundCloudGateway and classifies with the pure strict Auto-Match policy;
 * Match Resolution mutates Ambiguous/Unresolved Match Records (pick / search-
 * bind / skip) and persists them. Results always land in the Session File.
 *
 * Invariants:
 * - An ingest with zero valid Library Tracks does not create or replace a
 *   Session File, so bad uploads cannot wipe a good session.
 * - Re-ingest replaces library rows and clears Match Records.
 * - `clearSession` removes the Session File (Source Library + Match Records);
 *   it is idempotent when no session exists.
 * - `runCatalogMatch` requires a loaded session and a connected SoundCloud
 *   identity; it replaces Match Records for the full library on each pass.
 * - Resolve ops address Match Records by `matchIndex` into the current session
 *   array; they only mutate Ambiguous or Unresolved rows.
 * - In-app catalog search requires a connected SoundCloudGateway identity.
 */

import {
	createImportSession,
	withMatchRecords,
	type ImportSession
} from './import-session';
import type { LibraryRowValidationError, LibraryTrack } from './library-track';
import {
	acceptBoundTrack,
	acceptCandidateRecord,
	buildResolutionQueue,
	skipMatchRecord,
	summarizeMatchBuckets,
	type MatchBucketsSummary,
	type MatchRecord,
	type ResolutionQueueItem
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
import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

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

export type ResolutionQueueResponse = {
	items: ResolutionQueueItem[];
	matchBuckets: MatchBucketsSummary;
};

export type AcceptCandidateRequest = {
	matchIndex: number;
	soundCloudTrackId: string;
};

export type BindSearchResultRequest = {
	matchIndex: number;
	soundCloudTrack: SoundCloudTrack;
};

export type SkipMatchRequest = {
	matchIndex: number;
};

export type ResolveMatchResponse = {
	session: ImportSessionSummary;
	matchBuckets: MatchBucketsSummary;
};

export type SearchCatalogRequest = {
	query: string;
};

export type SearchCatalogResponse = {
	tracks: SoundCloudTrack[];
};

export type ImportSessionApi = {
	ingestLibrary(request: IngestLibraryRequest): Promise<IngestLibraryResponse>;
	getSession(): Promise<GetSessionResponse>;
	/**
	 * Deletes the Session File — Source Library and Match Records. Does not
	 * touch SoundCloud credentials. Idempotent when already empty.
	 */
	clearSession(): Promise<GetSessionResponse>;
	runCatalogMatch(options?: RunCatalogMatchOptions): Promise<CatalogMatchResponse>;
	getResolutionQueue(): Promise<ResolutionQueueResponse>;
	acceptCandidate(request: AcceptCandidateRequest): Promise<ResolveMatchResponse>;
	bindSearchResult(request: BindSearchResultRequest): Promise<ResolveMatchResponse>;
	skipMatch(request: SkipMatchRequest): Promise<ResolveMatchResponse>;
	searchCatalog(request: SearchCatalogRequest): Promise<SearchCatalogResponse>;
	resolvePreview(request: {
		trackId: string;
	}): Promise<{ previewUrl: string | null; kind: 'progressive' | 'hls' | null }>;
};

export type CreateImportSessionApiOptions = {
	dataDir: string;
	/**
	 * Required for Catalog Match and Match Resolution search. Ingest/getSession
	 * work without it; match/resolve/search throw if missing or disconnected.
	 */
	gateway?: SoundCloudGateway;
};

/**
 * Builds an Import Session API bound to one data directory (Session File root)
 * and an optional SoundCloudGateway for Catalog Match / Match Resolution.
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

		async clearSession() {
			await store.clear();
			return { session: null };
		},

		async runCatalogMatch(matchOptions) {
			const activeGateway = requireGateway(gateway);
			await requireConnected(activeGateway, 'Catalog Match');

			const session = await requireSession(store);
			const total = session.libraryTracks.length;
			const matchRecords: MatchRecord[] = [];

			for (let index = 0; index < total; index += 1) {
				const libraryTrack = session.libraryTracks[index]!;
				const hits = await activeGateway.searchTracks(libraryTrackQuery(libraryTrack));
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
		},

		async getResolutionQueue() {
			const session = await store.read();
			if (!session || session.matchRecords.length === 0) {
				return {
					items: [],
					matchBuckets: summarizeMatchBuckets([])
				};
			}

			const activeGateway = gateway;
			let matchRecords = session.matchRecords;
			if (activeGateway) {
				const identity = await activeGateway.getIdentity();
				if (identity) {
					const hydrated = await hydrateAmbiguousCandidates(
						activeGateway,
						session.matchRecords
					);
					if (hydrated.changed) {
						matchRecords = hydrated.records;
						await store.write(withMatchRecords(session, matchRecords));
					}
				}
			}

			return {
				items: buildResolutionQueue(matchRecords),
				matchBuckets: summarizeMatchBuckets(matchRecords)
			};
		},

		async acceptCandidate(request) {
			const session = await requireSessionWithMatches(store);
			const record = requireResolvableRecord(session, request.matchIndex);
			if (record.classification !== 'ambiguous') {
				throw new Error('acceptCandidate requires an Ambiguous Match Record');
			}

			const nextRecord = acceptCandidateRecord(record, request.soundCloudTrackId);
			return persistResolvedRecord(store, session, request.matchIndex, nextRecord);
		},

		async bindSearchResult(request) {
			const session = await requireSessionWithMatches(store);
			const record = requireResolvableRecord(session, request.matchIndex);
			const nextRecord = acceptBoundTrack(record, request.soundCloudTrack);
			return persistResolvedRecord(store, session, request.matchIndex, nextRecord);
		},

		async skipMatch(request) {
			const session = await requireSessionWithMatches(store);
			const record = requireResolvableRecord(session, request.matchIndex);
			const nextRecord = skipMatchRecord(record);
			return persistResolvedRecord(store, session, request.matchIndex, nextRecord);
		},

		async searchCatalog(request) {
			const activeGateway = requireGateway(gateway);
			await requireConnected(activeGateway, 'Catalog search');
			const query = request.query.trim();
			if (!query) {
				return { tracks: [] };
			}
			const tracks = await activeGateway.searchTracks(query);
			return { tracks };
		},

		async resolvePreview(request) {
			const activeGateway = requireGateway(gateway);
			await requireConnected(activeGateway, 'Preview');
			const trackId = request.trackId.trim();
			if (!trackId) {
				return { previewUrl: null, kind: null };
			}
			const media = await activeGateway.resolveListenMedia(trackId);
			if (!media) {
				return { previewUrl: null, kind: null };
			}
			return { previewUrl: media.url, kind: media.kind };
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

function requireGateway(gateway: SoundCloudGateway | undefined): SoundCloudGateway {
	if (!gateway) {
		throw new Error('SoundCloudGateway is required');
	}
	return gateway;
}

async function requireConnected(gateway: SoundCloudGateway, action: string): Promise<void> {
	const identity = await gateway.getIdentity();
	if (!identity) {
		throw new Error(`${action} requires a connected SoundCloud account`);
	}
}

async function requireSession(
	store: ReturnType<typeof createSessionFileStore>
): Promise<ImportSession> {
	const session = await store.read();
	if (!session || session.libraryTracks.length === 0) {
		throw new Error('Catalog Match requires a loaded Import Session');
	}
	return session;
}

async function requireSessionWithMatches(
	store: ReturnType<typeof createSessionFileStore>
): Promise<ImportSession> {
	const session = await store.read();
	if (!session || session.matchRecords.length === 0) {
		throw new Error('Match Resolution requires Match Records from Catalog Match');
	}
	return session;
}

function requireResolvableRecord(
	session: ImportSession,
	matchIndex: number
): Extract<MatchRecord, { classification: 'ambiguous' | 'unresolved' }> {
	if (
		!Number.isInteger(matchIndex) ||
		matchIndex < 0 ||
		matchIndex >= session.matchRecords.length
	) {
		throw new Error(`Match Record index ${matchIndex} is out of range`);
	}
	const record = session.matchRecords[matchIndex]!;
	if (record.classification !== 'ambiguous' && record.classification !== 'unresolved') {
		throw new Error(
			`Match Record at index ${matchIndex} is ${record.classification}, not Ambiguous or Unresolved`
		);
	}
	return record;
}

async function persistResolvedRecord(
	store: ReturnType<typeof createSessionFileStore>,
	session: ImportSession,
	matchIndex: number,
	nextRecord: MatchRecord
): Promise<ResolveMatchResponse> {
	const matchRecords = session.matchRecords.slice();
	matchRecords[matchIndex] = nextRecord;
	const next = withMatchRecords(session, matchRecords);
	await store.write(next);
	const matchBuckets = summarizeMatchBuckets(matchRecords);
	return {
		session: toSummary(next),
		matchBuckets
	};
}

/**
 * Session File candidates from older Catalog Match passes lack artwork/duration
 * (and may still carry OAuth-gated previewUrl). Refetch those rows once so Match
 * Resolution cards match live search hits without forcing a full rematch.
 */
async function hydrateAmbiguousCandidates(
	gateway: SoundCloudGateway,
	records: MatchRecord[]
): Promise<{ records: MatchRecord[]; changed: boolean }> {
	let changed = false;
	const nextRecords: MatchRecord[] = [];

	for (const record of records) {
		if (record.classification !== 'ambiguous') {
			nextRecords.push(record);
			continue;
		}

		const candidates: SoundCloudTrack[] = [];
		for (const candidate of record.candidates) {
			const cleaned = stripGatedPreviewUrl(candidate);
			if (cleaned !== candidate) {
				changed = true;
			}

			const needsMeta =
				cleaned.artworkUrl === undefined || cleaned.durationMs === undefined;
			if (!needsMeta) {
				candidates.push(cleaned);
				continue;
			}

			const fresh = await gateway.getTrack(cleaned.id);
			if (!fresh) {
				candidates.push(cleaned);
				continue;
			}

			changed = true;
			candidates.push({
				...cleaned,
				title: fresh.title,
				artist: fresh.artist,
				...(fresh.permalinkUrl ? { permalinkUrl: fresh.permalinkUrl } : {}),
				...(fresh.artworkUrl ? { artworkUrl: fresh.artworkUrl } : {}),
				...(fresh.durationMs !== undefined ? { durationMs: fresh.durationMs } : {}),
				...(fresh.previewUrl ? { previewUrl: fresh.previewUrl } : {})
			});
		}

		nextRecords.push({ ...record, candidates });
	}

	return { records: nextRecords, changed };
}

/** Older sessions stored api.soundcloud.com preview URLs that `<audio>` cannot use. */
function stripGatedPreviewUrl(track: SoundCloudTrack): SoundCloudTrack {
	const previewUrl = track.previewUrl;
	if (!previewUrl) {
		return track;
	}
	try {
		const host = new URL(previewUrl).hostname.toLowerCase();
		if (host === 'api.soundcloud.com' || host.endsWith('.api.soundcloud.com')) {
			const { previewUrl: _drop, ...rest } = track;
			return rest;
		}
	} catch {
		const { previewUrl: _drop, ...rest } = track;
		return rest;
	}
	return track;
}
