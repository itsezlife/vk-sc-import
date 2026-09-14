<script lang="ts">
	import { emptyStateGuidance } from '$lib/shell/empty-state-guidance';

	/**
	 * Shell defaults: nothing is wired yet. Later issues flip these when OAuth
	 * and Source Library ingest exist; until then the landing must stay honest.
	 */
	const readiness = $state({
		soundCloudConnected: false,
		sourceLibraryLoaded: false
	});

	const guidance = $derived(emptyStateGuidance(readiness));
</script>

<div
	class="min-h-screen bg-[radial-gradient(900px_480px_at_8%_-8%,#9fd0c8_0%,transparent_55%),radial-gradient(700px_420px_at_100%_0%,#b7c7e8_0%,transparent_48%),linear-gradient(160deg,#e8eef4_0%,#d9e3ea_45%,#cfd9e2_100%)] px-[clamp(1.25rem,4vw,3rem)] py-[clamp(1.5rem,4vw,3rem)] font-shell text-slate-900"
>
	<header class="mb-10 max-w-xl">
		<p
			class="m-0 text-[clamp(2.25rem,6vw,3.4rem)] leading-[0.95] font-semibold tracking-[-0.04em] text-slate-950"
		>
			vk-sc-import
		</p>
		<p class="mt-3 max-w-lg text-[1.05rem] leading-snug text-slate-600">
			Catalog-match a Source Library of VK likes into a SoundCloud Import Playlist.
		</p>
	</header>

	<main
		class="max-w-xl rounded-2xl border border-slate-900/10 bg-white/70 p-[clamp(1.2rem,3vw,1.7rem)] shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-md"
	>
		<h1
			class="m-0 text-[clamp(1.5rem,3.5vw,1.95rem)] leading-tight tracking-[-0.02em] text-slate-950"
		>
			{guidance.headline}
		</h1>
		<p class="mt-3 text-base leading-relaxed text-slate-600">{guidance.summary}</p>

		<ol class="mt-6 grid list-none gap-3 p-0">
			{#each guidance.steps as step (step.id)}
				<li
					class="rounded-xl border border-slate-900/10 bg-white/80 px-4 py-3.5"
					data-status={step.status}
				>
					<div class="flex items-center gap-2.5">
						<span
							class="h-2.5 w-2.5 shrink-0 rounded-full {step.status === 'done'
								? 'bg-emerald-600'
								: 'bg-amber-600'}"
							aria-hidden="true"
						></span>
						<span class="flex-1 text-[1.02rem] font-semibold text-slate-900">{step.title}</span>
						<span
							class="text-[0.7rem] tracking-wider uppercase {step.status === 'done'
								? 'text-emerald-700'
								: 'text-amber-700'}"
						>
							{step.status === 'done' ? 'Done' : 'Needed'}
						</span>
					</div>
					<p class="mt-2 text-[0.95rem] leading-snug text-slate-600">{step.detail}</p>
					{#if step.status === 'needed'}
						<button
							type="button"
							class="mt-3 inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-teal-700/30 bg-teal-50 px-3.5 py-2 text-sm text-teal-800 opacity-85"
							disabled
						>
							{step.title}
							<span class="text-[0.68rem] tracking-wider uppercase opacity-70">soon</span>
						</button>
					{/if}
				</li>
			{/each}
		</ol>

		{#if guidance.readyToMatch}
			<p class="mt-5 rounded-lg bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800" role="status">
				Setup complete for this shell. Matching arrives in a later build.
			</p>
		{/if}
	</main>
</div>
