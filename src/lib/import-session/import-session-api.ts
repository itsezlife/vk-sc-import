/**
 * Import Session API — the HTTP/JSON seam for library ingest, Catalog Match,
 * Match Resolution, Import Playlist write, post-write review / Rematch,
 * Match Record export, and Session File I/O.
 *
 * Routes and seam tests share this contract. Catalog Match searches through
 * SoundCloudGateway and classifies with the pure strict Auto-Match policy;
 * Match Resolution mutates Ambiguous/Unresolved Match Records (pick / search-
 * bind / skip) and persists them. Import Playlist write creates one dated
 * playlist, adds Auto + Accepted tracks (not likes-as-destination), flags
 * `alreadyOnSc` from likes presence, and stores playlist identity on the
 * Session File. Rematch replaces a bound SoundCloud Track, rebuilds playlist
 * membership via `setPlaylistTracks` (remove/add equivalent), refreshes
 * `alreadyOnSc`, and persists — so mistakes are fixed without soundcloud.com.
 *
 * Long Catalog Match / playlist write runs accept `AbortSignal` and default
 * pacing suitable for 1000+ tracks. After each completed library row or
 * playlist membership step the Session File is rewritten (atomic rename), so
 * cancel keeps valid progress. Incomplete Catalog Match (`matchRecords.length`
 * &lt; library) resumes on the next call; a complete prior pass is replaced.
 * Incomplete playlist write (`importPlaylistWriteStatus: 'in_progress'`)
 * reuses the same playlist id; a complete write may be re-run idempotently
 * (same playlist, membership PUT again).
 *
 * Invariants:
 * - An ingest with zero valid Library Tracks does not create or replace a
 *   Session File, so bad uploads cannot wipe a good session.
 * - Re-ingest replaces library rows and clears Match Records.
 * - `clearSession` removes the Session File (Source Library + Match Records);
 *   it is idempotent when no session exists.
 * - `runCatalogMatch` requires a loaded session and a connected SoundCloud
 *   identity; a fresh (non-resume) pass clears prior Import Playlist identity.
 * - Resolve ops address Match Records by `matchIndex` into the current session
 *   array; they only mutate Ambiguous or Unresolved rows.
 * - In-app catalog search requires a connected SoundCloudGateway identity.
 * - `writeImportPlaylist` requires connected gateway and bound Auto/Accepted
 *   Match Records; paced `setPlaylistTracks` calls keep large adds
 *   rate-limit-friendly.
 * - `getReviewList` returns bound Auto/Accepted rows only after Import Playlist
 *   write is **complete** (empty while in progress or before write).
 * - `rematch` requires connected gateway, a **complete** Import Playlist on the
 *   session, and a bound Match Record at `matchIndex`.
 * - Export methods require Match Records; they do not mutate the Session File.
 */

import { importPlaylistTitle } from './import-playlist-title';
import {
	createImportSession,
	isImportPlaylistWriteComplete,
	withImportPlaylistWrite,
	withMatchRecords,
	withoutImportPlaylist,
	type ImportPlaylistWriteStatus,
	type ImportSession
} from './import-session';
import type { LibraryRowValidationError, LibraryTrack } from './library-track';
import {
	buildMatchRecordsExport,
	buildUnresolvedExport,
	stringifyMatchExport,
	type MatchRecordsExportDocument,
	type UnresolvedExportDocument
} from './match-export';
import {
	acceptBoundTrack,
	acceptCandidateRecord,
	boundPlaylistTrackIds,
	buildResolutionQueue,
	buildReviewList,
	rematchBoundTrack,
	skipMatchRecord,
	summarizeMatchBuckets,
	type MatchBucketsSummary,
	type MatchRecord,
	type ResolutionQueueItem,
	type ReviewListItem
} from './match-record';
import {
	classifyMatch,
	libraryTrackQuery,
	scoreSoundCloudCandidate
} from './match-score';
import { sleep, throwIfAborted } from './run-abort';
import { createSessionFileStore } from './session-file-store';
import {
	ingestSourceLibrary,
	type SourceLibraryFormat
} from './source-library-ingest';
import type { ImportPlaylist } from '$lib/soundcloud/import-playlist';
import type { SoundCloudGateway } from '$lib/soundcloud/soundcloud-gateway';
import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

const SAMPLE_SIZE = 5;
/**
 * Default pause between Catalog Match searches (ms). ~150ms keeps 1000+
 * searches under typical SoundCloud rate-limit pressure without feeling stuck.
 */
const DEFAULT_MATCH_PACE_MS = 150;
/** Default pause between paced playlist membership updates (ms). */
const DEFAULT_PLAYLIST_PACE_MS = 150;

/** UI / HTTP summary of a loaded Import Session — not the Session File. */
export type ImportSessionSummary = {
	trackCount: number;
	sample: LibraryTrack[];
	/** Null until at least one Catalog Match row was persisted. */
	matchBuckets: MatchBucketsSummary | null;
	/**
	 * How many Match Records are on disk vs library size — equal when the last
	 * Catalog Match pass finished (or none started).
	 */
	matchedCount: number;
	/** Null until Import Playlist create succeeded (may still be in progress). */
	importPlaylist: ImportPlaylist | null;
	/**
	 * Null when no playlist identity. Legacy complete Session Files surface as
	 * `complete` even without a stored status field.
	 */
	importPlaylistWriteStatus: ImportPlaylistWriteStatus | null;
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
	/**
	 * Pause between each Catalog Match search. Tests pass `0`; live default is
	 * basic rate-limit pacing for large libraries.
	 */
	paceMs?: number;
	/** When aborted, the last persisted Match Record prefix is kept. */
	signal?: AbortSignal;
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

export type ImportPlaylistWriteProgress = {
	completed: number;
	total: number;
	current: LibraryTrack;
};

export type WriteImportPlaylistOptions = {
	onProgress?: (progress: ImportPlaylistWriteProgress) => void;
	/**
	 * Pause between each `setPlaylistTracks` call. Tests pass `0`; live default
	 * is basic rate-limit pacing.
	 */
	paceMs?: number;
	/** Clock for dated playlist title (and Session File `updatedAt`). */
	now?: Date;
	/** When aborted, playlist identity + completed membership steps stay on disk. */
	signal?: AbortSignal;
};

export type WriteImportPlaylistResponse = {
	session: ImportSessionSummary;
	importPlaylist: ImportPlaylist;
	writtenCount: number;
	alreadyOnScCount: number;
};

export type ReviewListResponse = {
	items: ReviewListItem[];
	matchBuckets: MatchBucketsSummary;
};

export type RematchRequest = {
	matchIndex: number;
	soundCloudTrack: SoundCloudTrack;
};

export type RematchResponse = {
	session: ImportSessionSummary;
	matchBuckets: MatchBucketsSummary;
	review: ReviewListResponse;
};

export type ExportUnresolvedResponse = {
	document: UnresolvedExportDocument;
	body: string;
	filename: string;
};

export type ExportMatchRecordsResponse = {
	document: MatchRecordsExportDocument;
	body: string;
	filename: string;
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
	writeImportPlaylist(
		options?: WriteImportPlaylistOptions
	): Promise<WriteImportPlaylistResponse>;
	/** Bound Auto/Accepted Match Records for post-write review (empty before complete write). */
	getReviewList(): Promise<ReviewListResponse>;
	/**
	 * Rematch a bound Match Record: replace SoundCloud Track, rebuild Import
	 * Playlist membership, refresh `alreadyOnSc`, persist Session File.
	 */
	rematch(request: RematchRequest): Promise<RematchResponse>;
	/** Downloadable Unresolved list (artist/title + deferred) — Session File unchanged. */
	exportUnresolved(exportedAt?: Date): Promise<ExportUnresolvedResponse>;
	/** Downloadable full Match Records export — Session File unchanged. */
	exportMatchRecords(exportedAt?: Date): Promise<ExportMatchRecordsResponse>;
};

export type CreateImportSessionApiOptions = {
	dataDir: string;
	/**
	 * Required for Catalog Match, Match Resolution search, Import Playlist
	 * write, and Rematch. Ingest/getSession work without it; match/resolve/
	 * write/rematch throw if missing or disconnected.
	 */
	gateway?: SoundCloudGateway;
};

/**
 * Builds an Import Session API bound to one data directory (Session File root)
 * and an optional SoundCloudGateway for Catalog Match / Match Resolution /
 * Import Playlist write / Rematch.
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
			const signal = matchOptions?.signal;
			const paceMs = matchOptions?.paceMs ?? DEFAULT_MATCH_PACE_MS;

			throwIfAborted(signal);

			const incomplete =
				session.matchRecords.length > 0 && session.matchRecords.length < total;
			const startIndex = incomplete ? session.matchRecords.length : 0;
			let matchRecords: MatchRecord[] = incomplete
				? session.matchRecords.slice()
				: [];
			let baseSession: ImportSession = incomplete
				? session
				: withoutImportPlaylist(session);

			if (!incomplete) {
				// Fresh pass: clear prior Match Records + playlist so cancel cannot
				// leave a stale complete set beside a new prefix.
				baseSession = withMatchRecords(baseSession, []);
				await store.write(baseSession);
			}

			for (let index = startIndex; index < total; index += 1) {
				throwIfAborted(signal);

				const libraryTrack = session.libraryTracks[index]!;
				const hits = await activeGateway.searchTracks(libraryTrackQuery(libraryTrack));
				const scored = hits.map((track) => ({
					track,
					score: scoreSoundCloudCandidate(libraryTrack, track)
				}));
				const record = classifyMatch(libraryTrack, scored);
				matchRecords.push(record);

				baseSession = withMatchRecords(baseSession, matchRecords);
				await store.write(baseSession);

				matchOptions?.onProgress?.({
					completed: index + 1,
					total,
					current: libraryTrack
				});

				if (paceMs > 0 && index < total - 1) {
					await sleep(paceMs, signal);
				}
			}

			const matchBuckets = summarizeMatchBuckets(matchRecords);
			return {
				session: toSummary(baseSession),
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
		},

		async writeImportPlaylist(writeOptions) {
			const activeGateway = requireGateway(gateway);
			await requireConnected(activeGateway, 'Import Playlist write');

			const session = await requireSessionWithMatches(store);
			const signal = writeOptions?.signal;
			throwIfAborted(signal);

			const boundIndexes: number[] = [];
			for (let index = 0; index < session.matchRecords.length; index += 1) {
				const record = session.matchRecords[index]!;
				if (record.classification === 'auto' || record.classification === 'accepted') {
					boundIndexes.push(index);
				}
			}
			if (boundIndexes.length === 0) {
				throw new Error(
					'Import Playlist write requires bound Auto or Accepted Match Records'
				);
			}

			const now = writeOptions?.now ?? new Date();
			const paceMs = writeOptions?.paceMs ?? DEFAULT_PLAYLIST_PACE_MS;
			const likedIds = new Set(await activeGateway.listLikedTrackIds());

			let importPlaylist = session.importPlaylist;
			let working = session;
			const matchRecords = session.matchRecords.slice();

			if (!importPlaylist) {
				throwIfAborted(signal);
				const title = importPlaylistTitle(now);
				importPlaylist = await activeGateway.createPlaylist(title);
				working = withImportPlaylistWrite(
					working,
					importPlaylist,
					matchRecords,
					'in_progress',
					now
				);
				await store.write(working);
			} else if (isImportPlaylistWriteComplete(session)) {
				// Idempotent re-run: reuse playlist identity, rewrite membership.
				working = withImportPlaylistWrite(
					working,
					importPlaylist,
					matchRecords,
					'in_progress',
					now
				);
				await store.write(working);
			}

			const playlist = importPlaylist;

			const accumulatedIds: string[] = [];
			let alreadyOnScCount = 0;
			const total = boundIndexes.length;

			for (let step = 0; step < boundIndexes.length; step += 1) {
				throwIfAborted(signal);

				const matchIndex = boundIndexes[step]!;
				const record = matchRecords[matchIndex]!;
				if (record.classification !== 'auto' && record.classification !== 'accepted') {
					continue;
				}

				const trackId = record.soundCloudTrack.id;
				const alreadyOnSc = likedIds.has(trackId);
				matchRecords[matchIndex] = {
					...record,
					...(alreadyOnSc ? { alreadyOnSc: true as const } : {})
				};
				if (alreadyOnSc) {
					alreadyOnScCount += 1;
				}

				accumulatedIds.push(trackId);
				await activeGateway.setPlaylistTracks(playlist.id, accumulatedIds);

				const writeStatus: ImportPlaylistWriteStatus =
					step === boundIndexes.length - 1 ? 'complete' : 'in_progress';
				working = withImportPlaylistWrite(
					working,
					playlist,
					matchRecords,
					writeStatus,
					now
				);
				await store.write(working);

				writeOptions?.onProgress?.({
					completed: step + 1,
					total,
					current: record.libraryTrack
				});

				if (paceMs > 0 && step < boundIndexes.length - 1) {
					await sleep(paceMs, signal);
				}
			}

			return {
				session: toSummary(working),
				importPlaylist: playlist,
				writtenCount: accumulatedIds.length,
				alreadyOnScCount
			};
		},

		async getReviewList() {
			const session = await store.read();
			if (
				!session ||
				session.matchRecords.length === 0 ||
				!isImportPlaylistWriteComplete(session)
			) {
				return {
					items: [],
					matchBuckets: summarizeMatchBuckets(session?.matchRecords ?? [])
				};
			}
			return {
				items: buildReviewList(session.matchRecords),
				matchBuckets: summarizeMatchBuckets(session.matchRecords)
			};
		},

		async rematch(request) {
			const activeGateway = requireGateway(gateway);
			await requireConnected(activeGateway, 'Rematch');

			const session = await requireSessionWithMatches(store);
			if (!isImportPlaylistWriteComplete(session) || !session.importPlaylist) {
				throw new Error(
					'Rematch requires a completed Import Playlist write for this Import Session'
				);
			}

			const record = requireBoundRecord(session, request.matchIndex);
			const likedIds = new Set(await activeGateway.listLikedTrackIds());
			const alreadyOnSc = likedIds.has(request.soundCloudTrack.id);
			const nextRecord = rematchBoundTrack(record, request.soundCloudTrack, alreadyOnSc);

			const matchRecords = session.matchRecords.slice();
			matchRecords[request.matchIndex] = nextRecord;
			const playlistTrackIds = boundPlaylistTrackIds(matchRecords);
			await activeGateway.setPlaylistTracks(session.importPlaylist.id, playlistTrackIds);

			const next = withMatchRecords(session, matchRecords);
			await store.write(next);

			const matchBuckets = summarizeMatchBuckets(matchRecords);
			return {
				session: toSummary(next),
				matchBuckets,
				review: {
					items: buildReviewList(matchRecords),
					matchBuckets
				}
			};
		},

		async exportUnresolved(exportedAt = new Date()) {
			const session = await requireSessionWithMatches(store);
			const document = buildUnresolvedExport(session.matchRecords, exportedAt);
			return {
				document,
				body: stringifyMatchExport(document),
				filename: 'unresolved-tracks.json'
			};
		},

		async exportMatchRecords(exportedAt = new Date()) {
			const session = await requireSessionWithMatches(store);
			const document = buildMatchRecordsExport(session.matchRecords, exportedAt);
			return {
				document,
				body: stringifyMatchExport(document),
				filename: 'match-records.json'
			};
		}
	};
}

function toSummary(session: ImportSession): ImportSessionSummary {
	const matchBuckets =
		session.matchRecords.length > 0
			? summarizeMatchBuckets(session.matchRecords)
			: null;

	let importPlaylistWriteStatus: ImportPlaylistWriteStatus | null = null;
	if (session.importPlaylist) {
		importPlaylistWriteStatus = isImportPlaylistWriteComplete(session)
			? 'complete'
			: (session.importPlaylistWriteStatus ?? 'in_progress');
	}

	return {
		trackCount: session.libraryTracks.length,
		sample: session.libraryTracks.slice(0, SAMPLE_SIZE),
		matchBuckets,
		matchedCount: session.matchRecords.length,
		importPlaylist: session.importPlaylist ?? null,
		importPlaylistWriteStatus
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

function requireBoundRecord(
	session: ImportSession,
	matchIndex: number
): Extract<MatchRecord, { classification: 'auto' | 'accepted' }> {
	if (
		!Number.isInteger(matchIndex) ||
		matchIndex < 0 ||
		matchIndex >= session.matchRecords.length
	) {
		throw new Error(`Match Record index ${matchIndex} is out of range`);
	}
	const record = session.matchRecords[matchIndex]!;
	if (record.classification !== 'auto' && record.classification !== 'accepted') {
		throw new Error(
			`Rematch requires a bound Auto or Accepted Match Record at index ${matchIndex}`
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
