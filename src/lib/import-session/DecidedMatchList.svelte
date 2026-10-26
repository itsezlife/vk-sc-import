<script lang="ts">
	/**
	 * Decided list inside Match Resolution — Accepted and skipped rows the user
	 * can send back to the queue. Owns its own fetch / filter / open state; the
	 * panel owns the reopen request because it pins the reopened row as head.
	 *
	 * Fetched only while open: the list carries every bound SoundCloud Track,
	 * too heavy to ride along on each queue refresh.
	 */
	import type { DecidedListResponse } from '$lib/import-session/import-session-api';
	import type { DecidedListItem } from '$lib/import-session/match-record';
	import { t } from '$lib/i18n/ui.svelte';

	type Props = {
		count: number;
		/** Changes after every queue load — re-fetch while open. */
		refreshToken: number;
		busy: boolean;
		onReopen: (matchIndex: number) => void;
	};

	let { count, refreshToken, busy, onReopen }: Props = $props();

	/** Rendering hundreds of rows at once is slow to scan anyway — filter narrows. */
	const RENDER_LIMIT = 150;

	let open = $state(false);
	let loading = $state(false);
	let items = $state<DecidedListItem[]>([]);
	let acceptedLocked = $state(false);
	let filter = $state('');

	const filtered = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) {
			return items;
		}
		return items.filter((item) => {
			const { libraryTrack } = item.record;
			const haystack = [
				libraryTrack.artist,
				libraryTrack.title,
				...(item.record.classification === 'accepted'
					? [item.record.soundCloudTrack.artist, item.record.soundCloudTrack.title]
					: [])
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(needle);
		});
	});
	const shown = $derived(filtered.slice(0, RENDER_LIMIT));

	$effect(() => {
		void refreshToken;
		if (open) {
			void load();
		}
	});

	async function load() {
		loading = true;
		try {
			const response = await fetch('/api/session/resolve/decided');
			if (!response.ok) {
				return;
			}
			const body = (await response.json()) as DecidedListResponse;
			// Already most recently decided first (server orders by history).
			items = body.items;
			acceptedLocked = body.acceptedLocked;
		} catch (error) {
			console.error('[DecidedMatchList] Failed to load decided rows', error);
		} finally {
			loading = false;
		}
	}
</script>

<div class="grid gap-2 border-t border-slate-900/10 pt-3" data-resolve-shortcuts-off>
	<button
		type="button"
		class="ui-btn ui-btn-muted inline-flex w-fit items-center justify-center rounded-lg border px-3 py-1.5 text-sm"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{open ? t('resolve.decidedHide') : t('resolve.decidedShow', { count })}
	</button>

	{#if open}
		<input
			type="search"
			class="ui-control rounded-lg border border-slate-900/15 bg-white px-3 py-2 text-slate-900"
			placeholder={t('resolve.decidedFilter')}
			bind:value={filter}
		/>

		{#if loading && items.length === 0}
			<div class="ui-busy" aria-live="polite" aria-busy="true">
				<span class="ui-busy-pulse" aria-hidden="true"></span>
				<span>{t('resolve.decidedLoading')}</span>
			</div>
		{:else if filtered.length === 0}
			<p class="m-0 text-slate-500">{t('resolve.decidedNoMatch')}</p>
		{:else}
			{#if filtered.length > shown.length}
				<p class="m-0 text-xs text-slate-500">
					{t('resolve.decidedShown', { shown: shown.length, total: filtered.length })}
				</p>
			{/if}
			<ul class="m-0 grid list-none gap-1.5 p-0">
				{#each shown as item (item.matchIndex)}
					{@const record = item.record}
					{@const locked = record.classification === 'accepted' && acceptedLocked}
					<li
						class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-900/10 bg-white px-3 py-2"
					>
						<span
							class="w-20 shrink-0 text-[0.7rem] tracking-wider uppercase {record.classification ===
							'accepted'
								? 'text-teal-800'
								: 'text-slate-500'}"
						>
							{record.classification === 'accepted'
								? t('resolve.decidedAccepted')
								: t('resolve.decidedSkipped')}
						</span>
						<div class="grid min-w-0 flex-1 gap-0.5">
							<p class="m-0 truncate font-medium text-slate-900">
								{record.libraryTrack.artist} — {record.libraryTrack.title}
							</p>
							{#if record.classification === 'accepted'}
								<p class="m-0 truncate text-xs text-slate-500">
									→ {record.soundCloudTrack.artist} — {record.soundCloudTrack.title}
								</p>
							{/if}
						</div>
						<button
							type="button"
							class="ui-btn ui-btn-muted inline-flex shrink-0 items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
							disabled={busy || locked}
							title={locked ? t('resolve.reopenLocked') : undefined}
							onclick={() => onReopen(item.matchIndex)}
						>
							{t('resolve.reopen')}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
