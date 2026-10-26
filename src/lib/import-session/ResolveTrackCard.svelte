<script lang="ts">
	/**
	 * One SoundCloud Track choice in Match Resolution or Rematch search
	 * (candidate / search hit). Same interaction meaning at both call sites —
	 * climb the extraction ladder here, not a god-card with mode flags for
	 * unrelated screens.
	 */
	import type { ListenMedia } from '$lib/soundcloud/listen-media';
	import { formatTrackDuration, type SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';
	import { playableListenMedia } from '$lib/ui/playable-listen-media';
	import { t } from '$lib/i18n/ui.svelte';

	type Props = {
		track: SoundCloudTrack;
		/** Primary confirm label — Pick vs Bind. */
		confirmLabel: string;
		busy: boolean;
		listenBusy: boolean;
		listening: boolean;
		listenMedia: ListenMedia | null;
		onListen: () => void;
		onConfirm: () => void;
		/**
		 * Keyboard cursor of the journey sits on this card — Enter / Space act on
		 * it. Optional: Rematch search has no keyboard map yet.
		 */
		highlighted?: boolean;
		/** Digit that jumps the keyboard cursor here (1–9), shown on the artwork. */
		shortcut?: string;
	};

	let {
		track,
		confirmLabel,
		busy,
		listenBusy,
		listening,
		listenMedia,
		onListen,
		onConfirm,
		highlighted = false,
		shortcut
	}: Props = $props();

	let cardEl = $state<HTMLLIElement | null>(null);

	// Keyboard moves can push the cursor below the fold (long hit lists);
	// `nearest` only scrolls when the card is actually out of view.
	$effect(() => {
		if (highlighted && cardEl) {
			cardEl.scrollIntoView({ block: 'nearest' });
		}
	});

	const durationLabel = $derived(
		track.durationMs !== undefined ? formatTrackDuration(track.durationMs) : null
	);
</script>

<li
	bind:this={cardEl}
	class="resolve-track-card"
	class:resolve-track-card-highlighted={highlighted}
	aria-current={highlighted ? 'true' : undefined}
>
	<div class="resolve-track-card-art-wrap">
		{#if track.artworkUrl}
			<img
				class="resolve-track-card-art"
				src={track.artworkUrl}
				alt=""
				width="56"
				height="56"
				loading="lazy"
				decoding="async"
			/>
		{:else}
			<div class="resolve-track-card-art resolve-track-card-art-empty" aria-hidden="true"></div>
		{/if}
		{#if shortcut}
			<kbd class="ui-kbd resolve-track-card-shortcut">{shortcut}</kbd>
		{/if}
	</div>

	<div class="resolve-track-card-body">
		<div class="resolve-track-card-meta">
			<p class="resolve-track-card-title">
				<span class="resolve-track-card-artist">{track.artist}</span>
				<span class="resolve-track-card-sep" aria-hidden="true">—</span>
				<span class="resolve-track-card-name">{track.title}</span>
			</p>
			{#if durationLabel}
				<p class="resolve-track-card-duration">{durationLabel}</p>
			{/if}
		</div>

		<div class="resolve-track-card-actions">
			<button
				type="button"
				class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
				disabled={busy || listenBusy}
				onclick={onListen}
			>
				{listenBusy ? t('resolve.previewLoading') : t('resolve.listen')}
				{#if highlighted}<kbd class="ui-kbd ml-1.5">Space</kbd>{/if}
			</button>
			{#if track.permalinkUrl}
				<button
					type="button"
					class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
					disabled={busy}
					onclick={() => window.open(track.permalinkUrl, '_blank', 'noopener,noreferrer')}
				>
					{t('resolve.openOnSoundCloud')}
				</button>
			{/if}
			<button
				type="button"
				class="ui-btn ui-btn-primary inline-flex items-center justify-center rounded-lg border border-teal-800/25 bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
				disabled={busy}
				onclick={onConfirm}
			>
				{busy ? t('resolve.busy') : confirmLabel}
				{#if highlighted && !busy}<kbd class="ui-kbd ml-1.5">Enter</kbd>{/if}
			</button>
		</div>
	</div>

	{#if listening && listenMedia}
		<!--
			Native <audio controls> on Safari/WebKit reserves a tall media box and
			pins the bar to the bottom — without an explicit height that looks like
			a huge empty gap under the buttons. Span full card width; clamp height.
		-->
		<audio
			class="ui-fade-in resolve-track-card-player"
			controls
			autoplay
			use:playableListenMedia={listenMedia}
		></audio>
	{/if}
</li>

<style>
	.resolve-track-card {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: start;
		margin: 0;
		padding: 0.75rem;
		list-style: none;
		border-radius: 0.75rem;
		border: 1px solid rgb(15 23 42 / 0.1);
		background: rgb(255 255 255);
		transition:
			border-color var(--duration-shell) var(--ease-shell),
			box-shadow var(--duration-shell) var(--ease-shell);
	}

	.resolve-track-card-highlighted {
		border-color: var(--color-teal-700);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-teal-700) 22%, transparent);
	}

	.resolve-track-card-art-wrap {
		position: relative;
	}

	.resolve-track-card-shortcut {
		position: absolute;
		top: -0.35rem;
		left: -0.35rem;
	}

	.resolve-track-card-art {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 0.5rem;
		object-fit: cover;
		background: rgb(241 245 249);
	}

	.resolve-track-card-art-empty {
		background: linear-gradient(145deg, rgb(226 232 240), rgb(241 245 249));
	}

	.resolve-track-card-body {
		display: grid;
		gap: 0.625rem;
		min-width: 0;
	}

	.resolve-track-card-meta {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}

	.resolve-track-card-title {
		margin: 0;
		font-weight: 600;
		color: rgb(15 23 42);
		line-height: 1.35;
	}

	.resolve-track-card-artist {
		color: rgb(51 65 85);
	}

	.resolve-track-card-sep {
		margin: 0 0.25rem;
		color: rgb(148 163 184);
		font-weight: 500;
	}

	.resolve-track-card-name {
		color: rgb(15 23 42);
	}

	.resolve-track-card-duration {
		margin: 0;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
		color: rgb(100 116 139);
	}

	.resolve-track-card-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.resolve-track-card-player {
		grid-column: 1 / -1;
		display: block;
		width: 100%;
		height: 2.5rem;
		max-height: 2.75rem;
	}
</style>
