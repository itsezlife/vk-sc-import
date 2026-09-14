<script lang="ts">
	/**
	 * Match Resolution journey — owns queue, search, and listen state.
	 * The shell page orchestrates session summary / when this panel is active;
	 * it must not hold resolve preview slots or search hits.
	 */
	import type { ImportSessionSummary } from '$lib/import-session/import-session-api';
	import type {
		MatchBucketsSummary,
		ResolutionQueueItem
	} from '$lib/import-session/match-record';
	import { libraryTrackQuery } from '$lib/import-session/match-score';
	import ResolveTrackCard from '$lib/import-session/ResolveTrackCard.svelte';
	import type { ListenMedia } from '$lib/soundcloud/listen-media';
	import { listenMediaKindFromUrl } from '$lib/soundcloud/listen-media';
	import { isCdnPlayablePreview } from '$lib/soundcloud/cdn-playable-preview';
	import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';
	import type { MessageKey } from '$lib/i18n/messages';
	import { getLocale, t } from '$lib/i18n/ui.svelte';

	type Props = {
		/**
		 * Null when Match Resolution is inactive. Non-null identity of the current
		 * match session (buckets + track count) — changes re-load the queue after
		 * Catalog Match or resolve mutations that update the shell summary.
		 */
		sessionKey: string | null;
		onSessionChange: (session: ImportSessionSummary) => void;
	};

	let { sessionKey, onSessionChange }: Props = $props();

	const active = $derived(sessionKey !== null);

	let resolveQueue = $state<ResolutionQueueItem[]>([]);
	let resolveBusy = $state(false);
	let resolveNotice = $state<{
		key: MessageKey;
		params?: Record<string, string | number>;
	} | null>(null);
	let searchQuery = $state('');
	let searchBusy = $state(false);
	let searchHits = $state<SoundCloudTrack[]>([]);
	let searchAttempted = $state(false);
	let searchGeneration = 0;
	let previewSlot = $state<string | null>(null);
	let previewMediaById = $state<Record<string, ListenMedia>>({});
	let previewBusySlot = $state<string | null>(null);

	const locale = $derived(getLocale());
	const resolveMessage = $derived(
		resolveNotice ? t(resolveNotice.key, resolveNotice.params, locale) : null
	);
	const currentResolveItem = $derived(resolveQueue[0] ?? null);
	const resolveSearchSeedKey = $derived(
		currentResolveItem
			? `${currentResolveItem.matchIndex}::${currentResolveItem.record.libraryTrack.artist}::${currentResolveItem.record.libraryTrack.title}`
			: null
	);

	$effect(() => {
		const key = sessionKey;
		if (key === null) {
			resolveQueue = [];
			clearCandidateUiState();
			searchQuery = '';
			resolveNotice = null;
			return;
		}
		void refreshResolutionQueue();
	});

	$effect(() => {
		const key = resolveSearchSeedKey;
		const item = currentResolveItem;
		if (sessionKey === null || !key || !item) {
			clearCandidateUiState();
			searchQuery = '';
			return;
		}

		// Drop the previous head's search hits / player before the next seed
		// search returns — otherwise the old card list lingers under the new track.
		clearCandidateUiState();
		const query = libraryTrackQuery(item.record.libraryTrack);
		searchQuery = query;
		void searchCatalog(query);
	});

	/** Invalidate in-flight search and wipe listen + hits for the prior queue head. */
	function clearCandidateUiState() {
		searchGeneration += 1;
		searchHits = [];
		searchAttempted = false;
		searchBusy = false;
		previewSlot = null;
		previewMediaById = {};
		previewBusySlot = null;
	}

	async function refreshResolutionQueue() {
		try {
			const response = await fetch('/api/session/resolve');
			if (!response.ok) {
				return;
			}
			const body = (await response.json()) as {
				items: ResolutionQueueItem[];
				matchBuckets: MatchBucketsSummary;
			};
			resolveQueue = body.items;
		} catch (error) {
			console.error('[MatchResolutionPanel] Failed to load resolution queue', error);
		}
	}

	async function applyResolveResult(body: {
		session: ImportSessionSummary;
		matchBuckets: MatchBucketsSummary;
	}) {
		onSessionChange(body.session);
		clearCandidateUiState();
		searchQuery = '';
		await refreshResolutionQueue();
	}

	async function acceptCandidate(soundCloudTrackId: string) {
		const item = currentResolveItem;
		if (!item || item.record.classification !== 'ambiguous') {
			return;
		}
		resolveBusy = true;
		resolveNotice = null;
		try {
			const response = await fetch('/api/session/resolve/accept', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					matchIndex: item.matchIndex,
					soundCloudTrackId
				})
			});
			const body = (await response.json()) as
				| { session: ImportSessionSummary; matchBuckets: MatchBucketsSummary }
				| { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			await applyResolveResult(body);
		} catch (error) {
			console.error('[MatchResolutionPanel] Failed to accept candidate', error);
			resolveNotice = {
				key: 'resolve.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			resolveBusy = false;
		}
	}

	async function skipCurrent() {
		const item = currentResolveItem;
		if (!item) {
			return;
		}
		resolveBusy = true;
		resolveNotice = null;
		try {
			const response = await fetch('/api/session/resolve/skip', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ matchIndex: item.matchIndex })
			});
			const body = (await response.json()) as
				| { session: ImportSessionSummary; matchBuckets: MatchBucketsSummary }
				| { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			await applyResolveResult(body);
		} catch (error) {
			console.error('[MatchResolutionPanel] Failed to skip Match Record', error);
			resolveNotice = {
				key: 'resolve.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			resolveBusy = false;
		}
	}

	async function searchCatalog(queryOverride?: string) {
		const query = (queryOverride ?? searchQuery).trim();
		if (!query) {
			searchHits = [];
			searchAttempted = false;
			searchGeneration += 1;
			return;
		}
		const generation = ++searchGeneration;
		searchBusy = true;
		resolveNotice = null;
		searchAttempted = true;
		try {
			const response = await fetch(
				`/api/session/resolve/search?q=${encodeURIComponent(query)}`
			);
			const body = (await response.json()) as
				| { tracks: SoundCloudTrack[] }
				| { error: string };
			if (generation !== searchGeneration) {
				return;
			}
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				searchHits = [];
				return;
			}
			searchHits = body.tracks;
		} catch (error) {
			if (generation !== searchGeneration) {
				return;
			}
			console.error('[MatchResolutionPanel] Failed to search SoundCloud catalog', error);
			resolveNotice = {
				key: 'resolve.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			if (generation === searchGeneration) {
				searchBusy = false;
			}
		}
	}

	async function bindSearchHit(track: SoundCloudTrack) {
		const item = currentResolveItem;
		if (!item) {
			return;
		}
		resolveBusy = true;
		resolveNotice = null;
		try {
			const response = await fetch('/api/session/resolve/bind', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					matchIndex: item.matchIndex,
					soundCloudTrack: track
				})
			});
			const body = (await response.json()) as
				| { session: ImportSessionSummary; matchBuckets: MatchBucketsSummary }
				| { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			await applyResolveResult(body);
		} catch (error) {
			console.error('[MatchResolutionPanel] Failed to bind search result', error);
			resolveNotice = {
				key: 'resolve.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			resolveBusy = false;
		}
	}

	async function listenTo(track: SoundCloudTrack, surface: 'candidate' | 'search') {
		const slot = `${surface}:${track.id}`;
		if (previewSlot === slot) {
			previewSlot = null;
			return;
		}

		const cached = previewMediaById[track.id];
		if (cached && isCdnPlayablePreview(cached.url)) {
			previewSlot = slot;
			return;
		}
		if (track.previewUrl && isCdnPlayablePreview(track.previewUrl)) {
			previewMediaById = {
				...previewMediaById,
				[track.id]: { url: track.previewUrl, kind: listenMediaKindFromUrl(track.previewUrl) }
			};
			previewSlot = slot;
			return;
		}

		previewBusySlot = slot;
		resolveNotice = null;
		try {
			const response = await fetch(
				`/api/session/resolve/preview?trackId=${encodeURIComponent(track.id)}`
			);
			const body = (await response.json()) as
				| { previewUrl: string | null; kind: 'progressive' | 'hls' | null }
				| { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: {
						message: 'error' in body ? body.error : `HTTP ${response.status}`
					}
				};
				return;
			}
			if (!body.previewUrl || !body.kind || !isCdnPlayablePreview(body.previewUrl)) {
				resolveNotice = { key: 'resolve.previewUnavailable' };
				if (track.permalinkUrl) {
					window.open(track.permalinkUrl, '_blank', 'noopener,noreferrer');
				}
				return;
			}
			previewMediaById = {
				...previewMediaById,
				[track.id]: { url: body.previewUrl, kind: body.kind }
			};
			previewSlot = slot;
		} catch (error) {
			console.error('[MatchResolutionPanel] Failed to resolve SoundCloud preview', error);
			resolveNotice = {
				key: 'resolve.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			previewBusySlot = null;
		}
	}
</script>

{#if active}
	<section
		class="ui-fade-in mt-5 grid gap-3 rounded-xl border border-slate-900/10 bg-white/85 px-4 py-4 text-sm text-slate-800"
		aria-labelledby="resolve-headline"
	>
		<div class="grid gap-1">
			<h2 id="resolve-headline" class="m-0 text-lg font-semibold text-slate-900">
				{t('resolve.headline')}
			</h2>
			<p class="m-0 text-slate-600">{t('resolve.summary')}</p>
			<p class="m-0 text-slate-500">
				{t('resolve.queueProgress', { count: resolveQueue.length })}
			</p>
		</div>

		{#if resolveMessage}
			<p class="ui-fade-in m-0 text-amber-900" role="status">{resolveMessage}</p>
		{/if}

		{#if !currentResolveItem}
			<p class="m-0 text-emerald-800" role="status">{t('resolve.empty')}</p>
		{:else}
			{@const item = currentResolveItem}
			{@const record = item.record}
			<div class="grid gap-3 rounded-lg bg-slate-50 px-3.5 py-3">
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="text-[0.7rem] tracking-wider uppercase {record.classification === 'ambiguous'
							? 'text-amber-700'
							: 'text-slate-500'}"
					>
						{record.classification === 'ambiguous'
							? t('resolve.ambiguousLabel')
							: t('resolve.unresolvedLabel')}
					</span>
					<p class="m-0 min-w-0 flex-1 text-base font-semibold text-slate-900">
						{record.libraryTrack.artist} — {record.libraryTrack.title}
					</p>
					<button
						type="button"
						class="ui-btn ui-btn-muted inline-flex shrink-0 items-center justify-center rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60"
						disabled={resolveBusy}
						onclick={skipCurrent}
					>
						{resolveBusy ? t('resolve.busy') : t('resolve.skip')}
					</button>
				</div>

				{#if record.classification === 'ambiguous'}
					<div class="grid gap-2">
						<p class="m-0 font-medium text-slate-800">{t('resolve.candidates')}</p>
						<ul class="m-0 grid list-none gap-2 p-0">
							{#each record.candidates as candidate (candidate.id)}
								<ResolveTrackCard
									track={candidate}
									confirmLabel={t('resolve.pick')}
									busy={resolveBusy}
									listenBusy={previewBusySlot === `candidate:${candidate.id}`}
									listening={previewSlot === `candidate:${candidate.id}`}
									listenMedia={previewMediaById[candidate.id] ?? null}
									onListen={() => listenTo(candidate, 'candidate')}
									onConfirm={() => acceptCandidate(candidate.id)}
								/>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="grid gap-2 border-t border-slate-900/10 pt-3">
					<label class="grid gap-1 text-slate-700">
						<span class="font-medium text-slate-800">{t('resolve.searchLabel')}</span>
						<div class="flex flex-wrap gap-2">
							<input
								type="search"
								class="ui-control min-w-0 flex-1 rounded-lg border border-slate-900/15 bg-white px-3 py-2 text-slate-900"
								placeholder={t('resolve.searchPlaceholder')}
								bind:value={searchQuery}
								disabled={resolveBusy || searchBusy}
								onkeydown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										void searchCatalog();
									}
								}}
							/>
							<button
								type="button"
								class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60"
								disabled={resolveBusy || searchBusy || searchQuery.trim() === ''}
								onclick={() => searchCatalog()}
							>
								{searchBusy ? t('resolve.searching') : t('resolve.search')}
							</button>
						</div>
					</label>

					{#if searchBusy && searchHits.length === 0}
						<div class="ui-busy" aria-live="polite" aria-busy="true">
							<span class="ui-busy-pulse" aria-hidden="true"></span>
							<span>{t('resolve.searching')}</span>
						</div>
					{/if}

					{#if searchHits.length > 0}
						<ul class="m-0 grid list-none gap-2 p-0">
							{#each searchHits as hit (hit.id)}
								<ResolveTrackCard
									track={hit}
									confirmLabel={t('resolve.bind')}
									busy={resolveBusy}
									listenBusy={previewBusySlot === `search:${hit.id}`}
									listening={previewSlot === `search:${hit.id}`}
									listenMedia={previewMediaById[hit.id] ?? null}
									onListen={() => listenTo(hit, 'search')}
									onConfirm={() => bindSearchHit(hit)}
								/>
							{/each}
						</ul>
					{:else if searchAttempted && !searchBusy}
						<p class="m-0 text-slate-500">{t('resolve.searchEmpty')}</p>
					{/if}
				</div>
			</div>
		{/if}
	</section>
{/if}
