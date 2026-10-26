<script lang="ts">
	/**
	 * Match Resolution journey — owns queue, search, and listen state.
	 * The shell page orchestrates session summary / when this panel is active;
	 * it must not hold resolve preview slots or search hits.
	 */
	import type { ImportSessionSummary } from '$lib/import-session/import-session-api';
	import type { MatchBucketsSummary, ResolutionQueueItem } from '$lib/import-session/match-record';
	import { libraryTrackQuery } from '$lib/import-session/match-score';
	import ResolveTrackCard from '$lib/import-session/ResolveTrackCard.svelte';
	import DecidedMatchList from '$lib/import-session/DecidedMatchList.svelte';
	import { resolveShortcutFor, type ResolveShortcut } from '$lib/import-session/resolve-shortcuts';
	import { getContextMenuSession } from '$lib/ui/context-menu.svelte';
	import type { ListenMedia } from '$lib/soundcloud/listen-media';
	import { listenMediaKindFromUrl } from '$lib/soundcloud/listen-media';
	import { isCdnPlayablePreview } from '$lib/soundcloud/cdn-playable-preview';
	import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';
	import type { MessageKey } from '$lib/i18n/messages';
	import { getLocale, t } from '$lib/i18n/ui.svelte';
	import { onMount } from 'svelte';

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
	/** Keyboard cursor into `choices`; clamped on read because hits arrive late. */
	let highlightIndex = $state(0);
	let panelEl = $state<HTMLElement | null>(null);
	let searchInputEl = $state<HTMLInputElement | null>(null);
	/** Decisions Back can undo — the Session File history, so it survives reloads. */
	let reopenableCount = $state(0);
	let decidedCount = $state(0);
	/** Bumped after every queue load so an open Decided list re-fetches. */
	let queueVersion = $state(0);
	/** Reopened row shown ahead of the queue order until it is decided again. */
	let pinnedMatchIndex = $state<number | null>(null);
	let backKeyLabel = $state('Ctrl+S');

	onMount(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) {
			backKeyLabel = '⌘S';
		}
	});

	const locale = $derived(getLocale());
	const resolveMessage = $derived(
		resolveNotice ? t(resolveNotice.key, resolveNotice.params, locale) : null
	);
	// Reopen puts the row back in buildResolutionQueue order (Ambiguous first,
	// then by index) — usually not at the head. Pin it so Back shows it now.
	const currentResolveItem = $derived(
		(pinnedMatchIndex !== null
			? resolveQueue.find((item) => item.matchIndex === pinnedMatchIndex)
			: undefined) ??
			resolveQueue[0] ??
			null
	);
	const resolveSearchSeedKey = $derived(
		currentResolveItem
			? `${currentResolveItem.matchIndex}::${currentResolveItem.record.libraryTrack.artist}::${currentResolveItem.record.libraryTrack.title}`
			: null
	);

	type ResolveChoice = {
		/** Same `${surface}:${id}` shape as listen slots. */
		slot: string;
		surface: 'candidate' | 'search';
		track: SoundCloudTrack;
	};

	// One keyboard list across both card groups: arrows walk from the last
	// candidate straight into search hits instead of stopping at a section edge.
	const candidateChoices = $derived<ResolveChoice[]>(
		currentResolveItem?.record.classification === 'ambiguous'
			? currentResolveItem.record.candidates.map((track) => ({
					slot: `candidate:${track.id}`,
					surface: 'candidate',
					track
				}))
			: []
	);
	const choices = $derived<ResolveChoice[]>([
		...candidateChoices,
		...searchHits.map((track) => ({
			slot: `search:${track.id}`,
			surface: 'search' as const,
			track
		}))
	]);
	const highlightedChoice = $derived(
		choices.length === 0 ? null : choices[Math.min(highlightIndex, choices.length - 1)]
	);

	$effect(() => {
		const key = sessionKey;
		if (key === null) {
			resolveQueue = [];
			reopenableCount = 0;
			decidedCount = 0;
			pinnedMatchIndex = null;
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
		highlightIndex = 0;
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
				reopenableCount: number;
				decidedCount: number;
			};
			resolveQueue = body.items;
			reopenableCount = body.reopenableCount;
			decidedCount = body.decidedCount;
			queueVersion += 1;
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

	function unpinDecided(item: ResolutionQueueItem) {
		if (pinnedMatchIndex === item.matchIndex) {
			pinnedMatchIndex = null;
		}
	}

	function reopenPrevious() {
		if (reopenableCount > 0) {
			void reopen('/api/session/resolve/reopen', { method: 'POST' });
		}
	}

	function reopenDecided(matchIndex: number) {
		void reopen('/api/session/resolve/decided', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ matchIndex })
		});
	}

	/** Back (newest history entry) and Decided list share the reopen response. */
	async function reopen(path: string, init: RequestInit) {
		if (resolveBusy) {
			return;
		}
		resolveBusy = true;
		resolveNotice = null;
		try {
			const response = await fetch(path, init);
			const body = (await response.json()) as
				| {
						session: ImportSessionSummary;
						matchBuckets: MatchBucketsSummary;
						matchIndex: number;
				  }
				| { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				// The server drops an entry it cannot undo; pick up the new count.
				await refreshResolutionQueue();
				return;
			}
			pinnedMatchIndex = body.matchIndex;
			await applyResolveResult(body);
			// The reopened track is now the head — bring it into view, since the
			// Decided list it came from can sit far below.
			panelEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		} catch (error) {
			console.error('[MatchResolutionPanel] Failed to reopen Match Record', error);
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
				{ session: ImportSessionSummary; matchBuckets: MatchBucketsSummary } | { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			unpinDecided(item);
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
				{ session: ImportSessionSummary; matchBuckets: MatchBucketsSummary } | { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			unpinDecided(item);
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

	/** Resolves true only when this call's hits landed (not superseded). */
	async function searchCatalog(queryOverride?: string): Promise<boolean> {
		const query = (queryOverride ?? searchQuery).trim();
		if (!query) {
			searchHits = [];
			searchAttempted = false;
			searchGeneration += 1;
			return false;
		}
		const generation = ++searchGeneration;
		searchBusy = true;
		resolveNotice = null;
		searchAttempted = true;
		try {
			const response = await fetch(`/api/session/resolve/search?q=${encodeURIComponent(query)}`);
			const body = (await response.json()) as { tracks: SoundCloudTrack[] } | { error: string };
			if (generation !== searchGeneration) {
				return false;
			}
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				searchHits = [];
				return false;
			}
			searchHits = body.tracks;
			return true;
		} catch (error) {
			if (generation !== searchGeneration) {
				return false;
			}
			console.error('[MatchResolutionPanel] Failed to search SoundCloud catalog', error);
			resolveNotice = {
				key: 'resolve.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
			return false;
		} finally {
			if (generation === searchGeneration) {
				searchBusy = false;
			}
		}
	}

	/**
	 * A manual search means the candidates did not fit — land the cursor on the
	 * first hit so Enter binds it, and leave the field so shortcuts work again.
	 */
	async function searchFromInput() {
		const landed = await searchCatalog();
		if (landed && searchHits.length > 0) {
			highlightIndex = candidateChoices.length;
			searchInputEl?.blur();
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
				{ session: ImportSessionSummary; matchBuckets: MatchBucketsSummary } | { error: string };
			if (!response.ok || 'error' in body) {
				resolveNotice = {
					key: 'resolve.failed',
					params: { message: 'error' in body ? body.error : `HTTP ${response.status}` }
				};
				return;
			}
			unpinDecided(item);
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
				{ previewUrl: string | null; kind: 'progressive' | 'hls' | null } | { error: string };
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

	// --- Keyboard ---

	function isTextEntry(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (
			!active ||
			event.defaultPrevented ||
			event.isComposing ||
			getContextMenuSession() !== null
		) {
			return;
		}
		const shortcut = resolveShortcutFor(event);
		if (!shortcut) {
			return;
		}
		// Back is a chord, so it cannot collide with typing or a focused shell
		// control — it works from anywhere on the page, including the search
		// field and an empty queue (undo the last decision).
		if (shortcut.kind === 'back') {
			event.preventDefault();
			reopenPrevious();
			return;
		}
		// Single keys are claimed only when focus is "nowhere" or inside this
		// journey — Enter on a shell button elsewhere keeps its native meaning.
		const target = event.target;
		const inPanel = target instanceof Node && panelEl?.contains(target);
		if (!(target === document.body || inPanel)) {
			return;
		}
		// The Decided list has its own buttons and filter; Enter there must not
		// submit the queue head's highlighted choice.
		if (target instanceof Element && target.closest('[data-resolve-shortcuts-off]')) {
			return;
		}
		if (!currentResolveItem || isTextEntry(target)) {
			return;
		}
		// A focused <audio> already maps Space / arrows to play and seek.
		if (
			target instanceof HTMLMediaElement &&
			(shortcut.kind === 'listen' || shortcut.kind === 'seek')
		) {
			return;
		}
		event.preventDefault();
		// Without blur a button focused by an earlier click would also activate
		// on Space keyup, e.g. Listen toggling twice.
		if (target instanceof HTMLElement && target !== document.body) {
			target.blur();
		}
		runShortcut(shortcut);
	}

	function runShortcut(shortcut: ResolveShortcut) {
		const choice = highlightedChoice;
		switch (shortcut.kind) {
			case 'move': {
				if (choices.length === 0) {
					return;
				}
				const from = Math.min(highlightIndex, choices.length - 1);
				highlightIndex = Math.max(0, Math.min(choices.length - 1, from + shortcut.delta));
				return;
			}
			case 'choose':
				if (shortcut.index < choices.length) {
					highlightIndex = shortcut.index;
				}
				return;
			case 'submit':
				if (!choice || resolveBusy) {
					return;
				}
				if (choice.surface === 'candidate') {
					void acceptCandidate(choice.track.id);
				} else {
					void bindSearchHit(choice.track);
				}
				return;
			case 'listen':
				if (choice && !resolveBusy && previewBusySlot === null) {
					void listenTo(choice.track, choice.surface);
				}
				return;
			case 'seek': {
				const audio = panelEl?.querySelector('audio');
				if (!audio) {
					return;
				}
				const end = Number.isFinite(audio.duration) ? audio.duration : Infinity;
				audio.currentTime = Math.max(0, Math.min(end, audio.currentTime + shortcut.seconds));
				return;
			}
			case 'skip':
				if (!resolveBusy) {
					void skipCurrent();
				}
				return;
			case 'back':
				reopenPrevious();
				return;
			case 'search':
				searchInputEl?.focus();
				searchInputEl?.select();
				return;
			case 'open':
				if (choice?.track.permalinkUrl) {
					window.open(choice.track.permalinkUrl, '_blank', 'noopener,noreferrer');
				}
				return;
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if active}
	<section
		bind:this={panelEl}
		class="ui-fade-in mt-5 grid gap-3 rounded-xl border border-slate-900/10 bg-white/85 px-4 py-4 text-sm text-slate-800"
		aria-labelledby="resolve-headline"
	>
		<div class="grid gap-1">
			<h2 id="resolve-headline" class="m-0 text-lg font-semibold text-slate-900">
				{t('resolve.headline')}
			</h2>
			<p class="m-0 text-slate-600">{t('resolve.summary')}</p>
			<div class="flex flex-wrap items-center gap-2">
				<p class="m-0 flex-1 text-slate-500">
					{t('resolve.queueProgress', { count: resolveQueue.length })}
				</p>
				{#if reopenableCount > 0}
					<button
						type="button"
						class="ui-btn ui-btn-muted inline-flex shrink-0 items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
						disabled={resolveBusy}
						onclick={reopenPrevious}
					>
						{t('resolve.back')}
						<kbd class="ui-kbd ml-1.5">{backKeyLabel}</kbd>
					</button>
				{/if}
			</div>
			{#if currentResolveItem}
				<ul
					class="resolve-keys m-0 list-none flex-wrap gap-x-4 gap-y-1.5 p-0 pt-1 text-xs text-slate-600"
				>
					<li>
						<kbd class="ui-kbd">↑</kbd> <kbd class="ui-kbd">↓</kbd> <kbd class="ui-kbd">1–9</kbd>
						{t('resolve.keyChoose')}
					</li>
					<li><kbd class="ui-kbd">Enter</kbd> {t('resolve.keySubmit')}</li>
					<li><kbd class="ui-kbd">Space</kbd> {t('resolve.keyListen')}</li>
					<li><kbd class="ui-kbd">←</kbd> <kbd class="ui-kbd">→</kbd> {t('resolve.keySeek')}</li>
					<li><kbd class="ui-kbd">S</kbd> {t('resolve.keySkip')}</li>
					<li><kbd class="ui-kbd">{backKeyLabel}</kbd> {t('resolve.keyBack')}</li>
					<li><kbd class="ui-kbd">/</kbd> {t('resolve.keySearch')}</li>
					<li><kbd class="ui-kbd">O</kbd> {t('resolve.keyOpen')}</li>
				</ul>
			{/if}
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
						{#if !resolveBusy}<kbd class="ui-kbd ml-1.5">S</kbd>{/if}
					</button>
				</div>

				{#if record.classification === 'ambiguous'}
					<div class="grid gap-2">
						<p class="m-0 font-medium text-slate-800">{t('resolve.candidates')}</p>
						<ul class="m-0 grid list-none gap-2 p-0">
							{#each record.candidates as candidate, index (candidate.id)}
								<ResolveTrackCard
									track={candidate}
									highlighted={highlightedChoice?.slot === `candidate:${candidate.id}`}
									shortcut={index < 9 ? String(index + 1) : undefined}
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
						<span class="flex items-center gap-1.5 font-medium text-slate-800">
							{t('resolve.searchLabel')}
							<kbd class="ui-kbd">/</kbd>
						</span>
						<div class="flex flex-wrap gap-2">
							<input
								type="search"
								class="ui-control min-w-0 flex-1 rounded-lg border border-slate-900/15 bg-white px-3 py-2 text-slate-900"
								placeholder={t('resolve.searchPlaceholder')}
								bind:this={searchInputEl}
								bind:value={searchQuery}
								disabled={resolveBusy || searchBusy}
								onkeydown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										void searchFromInput();
										return;
									}
									// Hand the keyboard back to the card list.
									if (event.key === 'Escape' || event.key === 'ArrowDown') {
										event.preventDefault();
										if (event.key === 'ArrowDown' && searchHits.length > 0) {
											highlightIndex = candidateChoices.length;
										}
										searchInputEl?.blur();
									}
								}}
							/>
							<button
								type="button"
								class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60"
								disabled={resolveBusy || searchBusy || searchQuery.trim() === ''}
								onclick={() => searchFromInput()}
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
							{#each searchHits as hit, index (hit.id)}
								{@const position = candidateChoices.length + index}
								<ResolveTrackCard
									track={hit}
									highlighted={highlightedChoice?.slot === `search:${hit.id}`}
									shortcut={position < 9 ? String(position + 1) : undefined}
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

		{#if decidedCount > 0}
			<DecidedMatchList
				count={decidedCount}
				refreshToken={queueVersion}
				busy={resolveBusy}
				onReopen={reopenDecided}
			/>
		{/if}
	</section>
{/if}

<style>
	.resolve-keys {
		display: flex;
	}

	.resolve-keys li {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	/* Touch-only devices have no keyboard to drive the queue — hide the legend. */
	@media (hover: none) and (pointer: coarse) {
		.resolve-keys {
			display: none;
		}
	}
</style>
