<script lang="ts">
	/**
	 * Post-write review / Rematch journey — owns review list, listen, and Rematch
	 * search state. The shell orchestrates when this panel is active (Import
	 * Playlist written); it must not hold preview slots or search hits.
	 */
	import type {
		ImportSessionSummary,
		RematchResponse,
		ReviewListResponse
	} from '$lib/import-session/import-session-api';
	import type { ReviewListItem } from '$lib/import-session/match-record';
	import { libraryTrackQuery } from '$lib/import-session/match-score';
	import ResolveTrackCard from '$lib/import-session/ResolveTrackCard.svelte';
	import type { ListenMedia } from '$lib/soundcloud/listen-media';
	import { listenMediaKindFromUrl } from '$lib/soundcloud/listen-media';
	import { isCdnPlayablePreview } from '$lib/soundcloud/cdn-playable-preview';
	import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';
	import { formatTrackDuration } from '$lib/soundcloud/soundcloud-track';
	import { playableListenMedia } from '$lib/ui/playable-listen-media';
	import type { MessageKey } from '$lib/i18n/messages';
	import { getLocale, t } from '$lib/i18n/ui.svelte';

	type Props = {
		/**
		 * Null when review is inactive. Non-null identity of the written Import
		 * Playlist + bound bucket counts — changes re-load the review list.
		 */
		sessionKey: string | null;
		onSessionChange: (session: ImportSessionSummary) => void;
	};

	let { sessionKey, onSessionChange }: Props = $props();

	const active = $derived(sessionKey !== null);

	let reviewItems = $state<ReviewListItem[]>([]);
	let rematchBusy = $state(false);
	let rematchNotice = $state<{
		key: MessageKey;
		params?: Record<string, string | number>;
	} | null>(null);
	let rematchMatchIndex = $state<number | null>(null);
	let searchQuery = $state('');
	let searchBusy = $state(false);
	let searchHits = $state<SoundCloudTrack[]>([]);
	let searchAttempted = $state(false);
	let searchGeneration = 0;
	let previewSlot = $state<string | null>(null);
	let previewMediaById = $state<Record<string, ListenMedia>>({});
	let previewBusySlot = $state<string | null>(null);

	const locale = $derived(getLocale());
	const rematchMessage = $derived(
		rematchNotice ? t(rematchNotice.key, rematchNotice.params, locale) : null
	);
	const rematchItem = $derived(
		rematchMatchIndex === null
			? null
			: (reviewItems.find((item) => item.matchIndex === rematchMatchIndex) ?? null)
	);
	const rematchSearchSeedKey = $derived(
		rematchItem
			? `${rematchItem.matchIndex}::${rematchItem.record.libraryTrack.artist}::${rematchItem.record.libraryTrack.title}`
			: null
	);

	$effect(() => {
		const key = sessionKey;
		if (key === null) {
			reviewItems = [];
			clearRematchUiState();
			rematchNotice = null;
			return;
		}
		void refreshReviewList();
	});

	$effect(() => {
		const key = rematchSearchSeedKey;
		const item = rematchItem;
		if (sessionKey === null || !key || !item) {
			clearSearchUiState();
			searchQuery = '';
			return;
		}
		clearSearchUiState();
		const query = libraryTrackQuery(item.record.libraryTrack);
		searchQuery = query;
		void searchCatalog(query);
	});

	function clearSearchUiState() {
		searchGeneration += 1;
		searchHits = [];
		searchAttempted = false;
		searchBusy = false;
		previewSlot = null;
		previewMediaById = {};
		previewBusySlot = null;
	}

	function clearRematchUiState() {
		rematchMatchIndex = null;
		searchQuery = '';
		clearSearchUiState();
	}

	async function refreshReviewList() {
		try {
			const response = await fetch('/api/session/review');
			const body = (await response.json()) as ReviewListResponse | { error: string };
			if (!response.ok || 'error' in body) {
				rematchNotice = {
					key: 'review.failed',
					params: {
						message: 'error' in body ? body.error : `HTTP ${response.status}`
					}
				};
				return;
			}
			reviewItems = body.items;
			if (
				rematchMatchIndex !== null &&
				!body.items.some((item) => item.matchIndex === rematchMatchIndex)
			) {
				clearRematchUiState();
			}
		} catch (error) {
			console.error('[ReviewRematchPanel] Failed to load review list', error);
			rematchNotice = {
				key: 'review.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		}
	}

	function startRematch(matchIndex: number) {
		if (rematchMatchIndex === matchIndex) {
			clearRematchUiState();
			return;
		}
		rematchNotice = null;
		rematchMatchIndex = matchIndex;
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
		rematchNotice = null;
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
				rematchNotice = {
					key: 'review.failed',
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
			console.error('[ReviewRematchPanel] Failed to search SoundCloud catalog', error);
			rematchNotice = {
				key: 'review.failed',
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

	async function confirmRematch(track: SoundCloudTrack) {
		const item = rematchItem;
		if (!item) {
			return;
		}
		rematchBusy = true;
		rematchNotice = null;
		try {
			const response = await fetch('/api/session/review/rematch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					matchIndex: item.matchIndex,
					soundCloudTrack: track
				})
			});
			const body = (await response.json()) as RematchResponse | { error: string };
			if (!response.ok || 'error' in body) {
				rematchNotice = {
					key: 'review.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			onSessionChange(body.session);
			reviewItems = body.review.items;
			clearRematchUiState();
			rematchNotice = { key: 'review.rematchDone' };
		} catch (error) {
			console.error('[ReviewRematchPanel] Failed to Rematch', error);
			rematchNotice = {
				key: 'review.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			rematchBusy = false;
		}
	}

	async function listenTo(track: SoundCloudTrack, surface: 'bound' | 'search') {
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
		rematchNotice = null;
		try {
			const response = await fetch(
				`/api/session/resolve/preview?trackId=${encodeURIComponent(track.id)}`
			);
			const body = (await response.json()) as
				| { previewUrl: string | null; kind: 'progressive' | 'hls' | null }
				| { error: string };
			if (!response.ok || 'error' in body) {
				rematchNotice = {
					key: 'review.failed',
					params: {
						message: 'error' in body ? body.error : `HTTP ${response.status}`
					}
				};
				return;
			}
			if (!body.previewUrl || !body.kind || !isCdnPlayablePreview(body.previewUrl)) {
				rematchNotice = { key: 'resolve.previewUnavailable' };
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
			console.error('[ReviewRematchPanel] Failed to resolve SoundCloud preview', error);
			rematchNotice = {
				key: 'review.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			previewBusySlot = null;
		}
	}

	function confidenceLabel(confidence: number): string {
		return `${Math.round(confidence * 100)}%`;
	}

	function classificationLabel(classification: 'auto' | 'accepted'): string {
		return classification === 'auto'
			? t('review.autoLabel')
			: t('review.acceptedLabel');
	}
</script>

{#if active}
	<section
		class="ui-fade-in mt-5 grid gap-3 rounded-xl border border-slate-900/10 bg-white/85 px-4 py-4 text-sm text-slate-800"
		aria-labelledby="review-headline"
	>
		<div class="grid gap-1">
			<h2 id="review-headline" class="m-0 text-lg font-semibold text-slate-900">
				{t('review.headline')}
			</h2>
			<p class="m-0 text-slate-600">{t('review.summary')}</p>
			<p class="m-0 text-slate-500">
				{t('review.count', { count: reviewItems.length })}
			</p>
		</div>

		{#if rematchMessage}
			<p class="ui-fade-in m-0 text-emerald-900" role="status">{rematchMessage}</p>
		{/if}

		{#if reviewItems.length === 0}
			<p class="m-0 text-slate-500" role="status">{t('review.empty')}</p>
		{:else}
			<ul class="m-0 grid list-none gap-3 p-0">
				{#each reviewItems as item (item.matchIndex)}
					{@const record = item.record}
					{@const sc = record.soundCloudTrack}
					{@const durationLabel =
						sc.durationMs !== undefined ? formatTrackDuration(sc.durationMs) : null}
					{@const isRematching = rematchMatchIndex === item.matchIndex}
					<li class="grid gap-3 rounded-lg bg-slate-50 px-3.5 py-3">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-[0.7rem] tracking-wider uppercase text-slate-500">
								{classificationLabel(record.classification)}
							</span>
							<span class="text-[0.7rem] tracking-wider uppercase text-teal-800">
								{t('review.confidence', { value: confidenceLabel(record.confidence) })}
							</span>
							{#if record.alreadyOnSc}
								<span class="text-[0.7rem] tracking-wider uppercase text-amber-700">
									{t('review.alreadyOnSc')}
								</span>
							{/if}
						</div>

						<div class="grid gap-1">
							<p class="m-0 font-medium text-slate-800">{t('review.libraryTrack')}</p>
							<p class="m-0 text-base font-semibold text-slate-900">
								{record.libraryTrack.artist} — {record.libraryTrack.title}
							</p>
						</div>

						<div class="grid gap-2 rounded-lg border border-slate-900/10 bg-white px-3 py-2.5">
							<p class="m-0 font-medium text-slate-800">{t('review.soundCloudTrack')}</p>
							<div class="flex flex-wrap items-start gap-3">
								{#if sc.artworkUrl}
									<img
										class="h-14 w-14 shrink-0 rounded-lg object-cover"
										src={sc.artworkUrl}
										alt=""
										width="56"
										height="56"
										loading="lazy"
										decoding="async"
									/>
								{/if}
								<div class="min-w-0 flex-1 grid gap-1">
									<p class="m-0 font-semibold text-slate-900">
										{sc.artist} — {sc.title}
									</p>
									{#if durationLabel}
										<p class="m-0 text-xs text-slate-500">{durationLabel}</p>
									{/if}
									<div class="flex flex-wrap gap-2 pt-1">
										<button
											type="button"
											class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
											disabled={rematchBusy || previewBusySlot === `bound:${sc.id}`}
											onclick={() => listenTo(sc, 'bound')}
										>
											{previewBusySlot === `bound:${sc.id}`
												? t('resolve.previewLoading')
												: t('resolve.listen')}
										</button>
										{#if sc.permalinkUrl}
											<button
												type="button"
												class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
												disabled={rematchBusy}
												onclick={() =>
													window.open(sc.permalinkUrl, '_blank', 'noopener,noreferrer')}
											>
												{t('resolve.openOnSoundCloud')}
											</button>
										{/if}
										<button
											type="button"
											class="ui-btn ui-btn-primary inline-flex items-center justify-center rounded-lg border border-teal-800/25 bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
											disabled={rematchBusy}
											onclick={() => startRematch(item.matchIndex)}
										>
											{isRematching ? t('review.cancelRematch') : t('review.rematch')}
										</button>
									</div>
								</div>
							</div>
							{#if previewSlot === `bound:${sc.id}` && previewMediaById[sc.id]}
								<audio
									class="ui-fade-in block h-10 w-full max-h-11"
									controls
									autoplay
									use:playableListenMedia={previewMediaById[sc.id]}
								></audio>
							{/if}
						</div>

						{#if isRematching}
							<div class="grid gap-2 border-t border-slate-900/10 pt-3">
								<label class="grid gap-1 text-slate-700">
									<span class="font-medium text-slate-800">{t('review.searchLabel')}</span>
									<div class="flex flex-wrap gap-2">
										<input
											type="search"
											class="ui-control min-w-0 flex-1 rounded-lg border border-slate-900/15 bg-white px-3 py-2 text-slate-900"
											placeholder={t('resolve.searchPlaceholder')}
											bind:value={searchQuery}
											disabled={rematchBusy || searchBusy}
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
											disabled={rematchBusy || searchBusy || searchQuery.trim() === ''}
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
												confirmLabel={t('review.confirmRematch')}
												busy={rematchBusy}
												listenBusy={previewBusySlot === `search:${hit.id}`}
												listening={previewSlot === `search:${hit.id}`}
												listenMedia={previewMediaById[hit.id] ?? null}
												onListen={() => listenTo(hit, 'search')}
												onConfirm={() => confirmRematch(hit)}
											/>
										{/each}
									</ul>
								{:else if searchAttempted && !searchBusy}
									<p class="m-0 text-slate-500">{t('resolve.searchEmpty')}</p>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
