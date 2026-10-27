/**
 * Import Session API — the HTTP/JSON seam for library ingest, Catalog Match,
 * Match Resolution, Import Playlist write, post-write review / Rematch,
 * Match Record export, and Session File I/O.
 *
 * Routes and seam tests share this contract. Catalog Match searches through
 * SoundCloudGateway and classifies with the pure strict Auto-Match policy;
 * Match Resolution mutates Ambiguous/Unresolved Match Records (pick / search-
 * bind / skip) and persists them. Import Playlist write creates one dated
 * playlist — split into parts of at most SOUNDCLOUD_PLAYLIST_TRACK_LIMIT
 * tracks — adds de-duplicated Auto + Accepted tracks (not likes-as-
 * destination), flags `alreadyOnSc` from likes presence, and stores part
 * identities on the Session File. Rematch replaces a bound SoundCloud Track,
 * rebuilds part membership via `setPlaylistTracks` (remove/add equivalent),
 * refreshes `alreadyOnSc`, and persists — so mistakes are fixed without
 * soundcloud.com.
 *
 * Long Catalog Match / playlist write runs accept `AbortSignal` and default
 * pacing suitable for 1000+ tracks. After each completed library row or
 * playlist membership step the Session File is rewritten (atomic rename), so
 * cancel keeps valid progress. Incomplete Catalog Match (`matchRecords.length`
 * &lt; library) resumes on the next call; a complete prior pass is replaced.
 * Incomplete playlist write (`importPlaylistWriteStatus: 'in_progress'`)
 * reuses the existing part ids; a complete write may be re-run idempotently
 * (same parts, membership PUT again).
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
 *   Match Records; paced, batched `setPlaylistTracks` calls keep large adds
 *   rate-limit-friendly.
 * - `getReviewList` returns bound Auto/Accepted rows only after Import Playlist
 *   write is **complete** (empty while in progress or before write).
 * - `rematch` requires connected gateway, a **complete** Import Playlist on the
 *   session, and a bound Match Record at `matchIndex`.
 * - Export methods require Match Records; they do not mutate the Session File.
 */

import { importPlaylistPartTitle, importPlaylistTitle } from './import-playlist-title';
import {
	createImportSession,
	isImportPlaylistWriteComplete,
	withImportPlaylistWrite,
	withMatchRecords,
	withoutImportPlaylist,
	withResolutionHistory,
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
	reopenMatchRecord,
	reopenDecidedRecord,
	buildDecidedList,
	type DecidedListItem,
	skipMatchRecord,
	summarizeMatchBuckets,
	type MatchBucketsSummary,
	type MatchRecord,
	type ResolutionQueueItem,
	type ReviewListItem
} from './match-record';
import { classifyMatch, libraryTrackQuery, scoreSoundCloudCandidate } from './match-score';
import { sleep, throwIfAborted } from './run-abort';
import { createSessionFileStore } from './session-file-store';
import { ingestSourceLibrary, type SourceLibraryFormat } from './source-library-ingest';
import {
	SOUNDCLOUD_PLAYLIST_TRACK_LIMIT,
	type ImportPlaylist
} from '$lib/soundcloud/import-playlist';
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
/**
 * Tracks added per membership PUT. Each PUT resends the part's full list, so
 * one-per-track would be ~n²/2 track refs for a 500-track part.
 */
const DEFAULT_PLAYLIST_BATCH_SIZE = 50;

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
	/**
	 * Import Playlist parts in membership order; empty until the first part's
	 * create succeeded (write may still be in progress).
	 */
	importPlaylists: ImportPlaylist[];
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
	/** Decisions Back can still undo (Session File `resolutionHistory` length). */
	reopenableCount: number;
	/** Accepted + skipped rows — size of the Decided list, fetched separately. */
	decidedCount: number;
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

export type DecidedListResponse = {
	items: DecidedListItem[];
	/**
	 * True once an Import Playlist exists: Accepted rows are then playlist
	 * members and cannot be reopened (Rematch owns changing them).
	 */
	acceptedLocked: boolean;
};

export type ReopenDecidedRequest = {
	matchIndex: number;
};

export type ReopenMatchResponse = ResolveMatchResponse & {
	/** Row that went back into the queue — the client shows it next. */
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
	/** Tracks added per `setPlaylistTracks` call (progress granularity). */
	batchSize?: number;
	/** Clock for dated playlist title (and Session File `updatedAt`). */
	now?: Date;
	/** When aborted, playlist identity + completed membership steps stay on disk. */
	signal?: AbortSignal;
};

export type WriteImportPlaylistResponse = {
	session: ImportSessionSummary;
	importPlaylists: ImportPlaylist[];
	/** Distinct SoundCloud Tracks written across all parts. */
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
	/**
	 * Undo the most recent pick / bind / skip from the Session File history —
	 * the row returns to the resolution queue as it was before that decision.
	 */
	reopenMatch(): Promise<ReopenMatchResponse>;
	/** Accepted + skipped rows the user can reopen from the Decided list. */
	getDecidedList(): Promise<DecidedListResponse>;
	/**
	 * Reopen any decided row. Uses its newest history entry when there is one
	 * (original candidates come back); otherwise reopens it as Unresolved.
	 */
	reopenDecided(request: ReopenDecidedRequest): Promise<ReopenMatchResponse>;
	searchCatalog(request: SearchCatalogRequest): Promise<SearchCatalogResponse>;
	resolvePreview(request: {
		trackId: string;
	}): Promise<{ previewUrl: string | null; kind: 'progressive' | 'hls' | null }>;
	writeImportPlaylist(options?: WriteImportPlaylistOptions): Promise<WriteImportPlaylistResponse>;
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
	/** Max tracks per Import Playlist part; tests shrink it to exercise splits. */
	playlistPartSize?: number;
};

/**
 * Builds an Import Session API bound to one data directory (Session File root)
 * and an optional SoundCloudGateway for Catalog Match / Match Resolution /
 * Import Playlist write / Rematch.
 */
export function createImportSessionApi(options: CreateImportSessionApiOptions): ImportSessionApi {
	const store = createSessionFileStore(options.dataDir);
	const gateway = options.gateway;
	const partSize = options.playlistPartSize ?? SOUNDCLOUD_PLAYLIST_TRACK_LIMIT;

	return {
		async ingestLibrary(request) {
			const { tracks, validationErrors } = ingestSourceLibrary(request.format, request.content);

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

			const incomplete = session.matchRecords.length > 0 && session.matchRecords.length < total;
			const startIndex = incomplete ? session.matchRecords.length : 0;
			let matchRecords: MatchRecord[] = incomplete ? session.matchRecords.slice() : [];
			let baseSession: ImportSession = incomplete ? session : withoutImportPlaylist(session);

			if (!incomplete) {
				// Fresh pass: clear prior Match Records + playlist so cancel cannot
				// leave a stale complete set beside a new prefix.
				baseSession = withMatchRecords(withResolutionHistory(baseSession, []), []);
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
					matchBuckets: summarizeMatchBuckets([]),
					reopenableCount: 0,
					decidedCount: 0
				};
			}

			const activeGateway = gateway;
			let matchRecords = session.matchRecords;
			if (activeGateway) {
				const identity = await activeGateway.getIdentity();
				if (identity) {
					const hydrated = await hydrateAmbiguousCandidates(activeGateway, session.matchRecords);
					if (hydrated.changed) {
						matchRecords = hydrated.records;
						await store.write(withMatchRecords(session, matchRecords));
					}
				}
			}

			return {
				items: buildResolutionQueue(matchRecords),
				matchBuckets: summarizeMatchBuckets(matchRecords),
				reopenableCount: session.resolutionHistory?.length ?? 0,
				decidedCount: buildDecidedList(matchRecords).length
			};
		},

		async acceptCandidate(request) {
			const session = await requireSessionWithMatches(store);
			const record = requireResolvableRecord(session, request.matchIndex);
			if (record.classification !== 'ambiguous') {
				throw new Error('acceptCandidate requires an Ambiguous Match Record');
			}

			const nextRecord = acceptCandidateRecord(record, request.soundCloudTrackId);
			return persistDecision(
				store,
				session,
				{ matchIndex: request.matchIndex, record },
				nextRecord
			);
		},

		async bindSearchResult(request) {
			const session = await requireSessionWithMatches(store);
			const record = requireResolvableRecord(session, request.matchIndex);
			const nextRecord = acceptBoundTrack(record, request.soundCloudTrack);
			return persistDecision(
				store,
				session,
				{ matchIndex: request.matchIndex, record },
				nextRecord
			);
		},

		async skipMatch(request) {
			const session = await requireSessionWithMatches(store);
			const record = requireResolvableRecord(session, request.matchIndex);
			const nextRecord = skipMatchRecord(record);
			return persistDecision(
				store,
				session,
				{ matchIndex: request.matchIndex, record },
				nextRecord
			);
		},

		async reopenMatch() {
			const session = await requireSessionWithMatches(store);
			const history = session.resolutionHistory ?? [];
			const entry = history.at(-1);
			if (!entry) {
				throw new Error('No Match Resolution decision to undo');
			}
			const remaining = history.slice(0, -1);
			const current = session.matchRecords[entry.matchIndex];

			let nextRecord: MatchRecord;
			try {
				if (!current) {
					throw new Error(`Match Record index ${entry.matchIndex} is out of range`);
				}
				// A bound row may already be a member of the written Import Playlist;
				// reopening it would leave that membership orphaned. Rematch owns that.
				if (current.classification === 'accepted' && session.importPlaylists) {
					throw new Error('Import Playlist already written — use Rematch to change this track');
				}
				nextRecord = reopenMatchRecord(current, entry.record);
			} catch (error) {
				// Without dropping it, an entry that can never be undone would pin
				// Back to the same error forever and hide every older decision.
				await store.write(withResolutionHistory(session, remaining));
				throw error;
			}

			const matchRecords = session.matchRecords.slice();
			matchRecords[entry.matchIndex] = nextRecord;
			const next = withMatchRecords(withResolutionHistory(session, remaining), matchRecords);
			await store.write(next);
			const matchBuckets = summarizeMatchBuckets(matchRecords);
			return { session: toSummary(next), matchBuckets, matchIndex: entry.matchIndex };
		},

		async getDecidedList() {
			const session = await store.read();
			return {
				items: session
					? buildDecidedList(session.matchRecords, session.resolutionHistory)
					: [],
				acceptedLocked: Boolean(session?.importPlaylists)
			};
		},

		async reopenDecided(request) {
			const session = await requireSessionWithMatches(store);
			const { matchIndex } = request;
			const current = session.matchRecords[matchIndex];
			if (
				!current ||
				!(
					current.classification === 'accepted' ||
					(current.classification === 'unresolved' && current.deferred === true)
				)
			) {
				throw new Error(`Match Record at index ${matchIndex} is not a decided row to reopen`);
			}
			if (current.classification === 'accepted' && session.importPlaylists) {
				throw new Error('Import Playlist already written — use Rematch to change this track');
			}

			// Prefer the history entry: it still holds the original candidates.
			// Remove it either way so ⌘S never replays a row reopened from here.
			const history = session.resolutionHistory ?? [];
			const at = history.findLastIndex((entry) => entry.matchIndex === matchIndex);
			let nextRecord: MatchRecord | null = null;
			if (at >= 0) {
				try {
					nextRecord = reopenMatchRecord(current, history[at]!.record);
				} catch {
					// Stale entry (different track / binding) — fall back below.
					nextRecord = null;
				}
			}
			nextRecord ??= reopenDecidedRecord(current);
			const remaining = at >= 0 ? history.filter((_, index) => index !== at) : history;

			const matchRecords = session.matchRecords.slice();
			matchRecords[matchIndex] = nextRecord;
			const next = withMatchRecords(withResolutionHistory(session, remaining), matchRecords);
			await store.write(next);
			const matchBuckets = summarizeMatchBuckets(matchRecords);
			return { session: toSummary(next), matchBuckets, matchIndex };
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

			const now = writeOptions?.now ?? new Date();
			const paceMs = writeOptions?.paceMs ?? DEFAULT_PLAYLIST_PACE_MS;
			const batchSize = writeOptions?.batchSize ?? DEFAULT_PLAYLIST_BATCH_SIZE;
			const likedIds = new Set(await activeGateway.listLikedTrackIds());

			const libraryTrackById = new Map<string, LibraryTrack>();
			const matchRecords = session.matchRecords.map((record) => {
				if (record.classification !== 'auto' && record.classification !== 'accepted') {
					return record;
				}
				const trackId = record.soundCloudTrack.id;
				if (!libraryTrackById.has(trackId)) {
					libraryTrackById.set(trackId, record.libraryTrack);
				}
				return likedIds.has(trackId) ? { ...record, alreadyOnSc: true as const } : record;
			});
			const trackIds = boundPlaylistTrackIds(matchRecords);
			if (trackIds.length === 0) {
				throw new Error('Import Playlist write requires bound Auto or Accepted Match Records');
			}
			const alreadyOnScCount = trackIds.filter((trackId) => likedIds.has(trackId)).length;
			const partTrackIds = chunk(trackIds, partSize);

			const parts = session.importPlaylists?.slice() ?? [];
			let working = session;
			if (parts.length > 0) {
				// Resume or idempotent re-run: reuse part identities, rewrite membership.
				working = withImportPlaylistWrite(working, parts.slice(), matchRecords, 'in_progress', now);
				await store.write(working);
			}

			const total = trackIds.length;
			for (let partIndex = 0; partIndex < partTrackIds.length; partIndex += 1) {
				throwIfAborted(signal);

				if (!parts[partIndex]) {
					const baseTitle = parts[0]?.title ?? importPlaylistTitle(now);
					parts.push(
						await activeGateway.createPlaylist(importPlaylistPartTitle(baseTitle, partIndex + 1))
					);
					working = withImportPlaylistWrite(working, parts.slice(), matchRecords, 'in_progress', now);
					await store.write(working);
				}

				const part = parts[partIndex]!;
				const ids = partTrackIds[partIndex]!;
				for (let start = 0; start < ids.length; start += batchSize) {
					throwIfAborted(signal);

					const end = Math.min(start + batchSize, ids.length);
					await activeGateway.setPlaylistTracks(part.id, ids.slice(0, end));

					writeOptions?.onProgress?.({
						completed: partIndex * partSize + end,
						total,
						current: libraryTrackById.get(ids[end - 1]!)!
					});

					const isLastCall = partIndex === partTrackIds.length - 1 && end === ids.length;
					if (paceMs > 0 && !isLastCall) {
						await sleep(paceMs, signal);
					}
				}
			}

			// Parts left over from a larger earlier write keep their identity but
			// must not keep stale membership.
			for (const extra of parts.slice(partTrackIds.length)) {
				await activeGateway.setPlaylistTracks(extra.id, []);
			}

			working = withImportPlaylistWrite(working, parts, matchRecords, 'complete', now);
			await store.write(working);

			return {
				session: toSummary(working),
				importPlaylists: parts,
				writtenCount: trackIds.length,
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
			if (!isImportPlaylistWriteComplete(session) || !session.importPlaylists) {
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
			const parts = await replaceImportPlaylistMembership(
				activeGateway,
				session.importPlaylists,
				chunk(boundPlaylistTrackIds(matchRecords), partSize)
			);

			const next = withImportPlaylistWrite(session, parts, matchRecords, 'complete');
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
		session.matchRecords.length > 0 ? summarizeMatchBuckets(session.matchRecords) : null;

	let importPlaylistWriteStatus: ImportPlaylistWriteStatus | null = null;
	if (session.importPlaylists) {
		importPlaylistWriteStatus = isImportPlaylistWriteComplete(session)
			? 'complete'
			: (session.importPlaylistWriteStatus ?? 'in_progress');
	}

	return {
		trackCount: session.libraryTracks.length,
		sample: session.libraryTracks.slice(0, SAMPLE_SIZE),
		matchBuckets,
		matchedCount: session.matchRecords.length,
		importPlaylists: session.importPlaylists ?? [],
		importPlaylistWriteStatus
	};
}

/**
 * Rebuilds every part's membership in one PUT each (Rematch). Creates a part
 * when the bound set outgrew the existing ones; empties surplus parts.
 */
async function replaceImportPlaylistMembership(
	gateway: SoundCloudGateway,
	parts: ImportPlaylist[],
	partTrackIds: string[][]
): Promise<ImportPlaylist[]> {
	const next = parts.slice();
	for (let partIndex = 0; partIndex < partTrackIds.length; partIndex += 1) {
		if (!next[partIndex]) {
			next.push(
				await gateway.createPlaylist(importPlaylistPartTitle(next[0]!.title, partIndex + 1))
			);
		}
		await gateway.setPlaylistTracks(next[partIndex]!.id, partTrackIds[partIndex]!);
	}
	for (const extra of next.slice(partTrackIds.length)) {
		await gateway.setPlaylistTracks(extra.id, []);
	}
	return next;
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		chunks.push(items.slice(start, start + size));
	}
	return chunks;
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

/** Pick / bind / skip: replace the row and push its prior form onto the undo stack. */
async function persistDecision(
	store: ReturnType<typeof createSessionFileStore>,
	session: ImportSession,
	before: ResolutionQueueItem,
	nextRecord: MatchRecord
): Promise<ResolveMatchResponse> {
	const matchRecords = session.matchRecords.slice();
	matchRecords[before.matchIndex] = nextRecord;
	const history = [...(session.resolutionHistory ?? []), before];
	const next = withMatchRecords(withResolutionHistory(session, history), matchRecords);
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

			const needsMeta = cleaned.artworkUrl === undefined || cleaned.durationMs === undefined;
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
