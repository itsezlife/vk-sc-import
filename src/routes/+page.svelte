<script lang="ts">
	import type { AppLocale } from '$lib/i18n/locale';
	import type { MessageKey } from '$lib/i18n/messages';
	import {
		getLocale,
		messagesFor,
		setLocale,
		t,
		translateValidationCode,
		withPlural
	} from '$lib/i18n/ui.svelte';
	import type { ImportSessionSummary } from '$lib/import-session/import-session-api';
	import type { LibraryRowValidationError, LibraryTrack } from '$lib/import-session/library-track';
	import type { SourceLibraryFormat } from '$lib/import-session/source-library-ingest';
	import { emptyStateGuidance } from '$lib/shell/empty-state-guidance';
	import { contextMenu } from '$lib/ui/context-menu-action';
	import type { ContextMenuEntry } from '$lib/ui/context-menu-types';
	import { onMount } from 'svelte';

	/**
	 * Shell readiness: SoundCloud stays false until OAuth (issue 03).
	 * Source Library flips when GET/POST /api/session* returns a session.
	 * Layout uses shell-* / ui-* SoT classes — no premature components.
	 */
	const readiness = $state({
		soundCloudConnected: false,
		sourceLibraryLoaded: false
	});

	let sessionSummary = $state<ImportSessionSummary | null>(null);
	let libraryDraft = $state('');
	let libraryFormat = $state<SourceLibraryFormat>('json');
	let validationErrors = $state<LibraryRowValidationError[]>([]);
	let ingestBusy = $state(false);
	let ingestNotice = $state<{
		key: MessageKey;
		params?: Record<string, string | number>;
		pluralCount?: number;
	} | null>(null);

	const locale = $derived(getLocale());
	const messages = $derived(messagesFor(locale));
	const guidance = $derived(emptyStateGuidance(readiness, messages));
	const ingestMessage = $derived(
		ingestNotice
			? ingestNotice.pluralCount !== undefined
				? withPlural(ingestNotice.key, ingestNotice.pluralCount, locale)
				: t(ingestNotice.key, ingestNotice.params, locale)
			: null
	);

	onMount(() => {
		document.documentElement.lang = locale;
		void restoreSession();
	});

	async function restoreSession() {
		try {
			const response = await fetch('/api/session');
			if (!response.ok) {
				ingestNotice = {
					key: 'library.restoreHttpError',
					params: { status: response.status }
				};
				return;
			}
			const body = (await response.json()) as { session: ImportSessionSummary | null };
			applySession(body.session);
		} catch (error) {
			console.error('[+page] Failed to restore Import Session', error);
			ingestNotice = { key: 'library.restoreFailed' };
		}
	}

	function applySession(session: ImportSessionSummary | null) {
		sessionSummary = session;
		readiness.sourceLibraryLoaded = session !== null && session.trackCount > 0;
	}

	async function onFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			return;
		}

		libraryDraft = await file.text();
		const lower = file.name.toLowerCase();
		if (lower.endsWith('.csv')) {
			libraryFormat = 'csv';
		} else if (lower.endsWith('.json')) {
			libraryFormat = 'json';
		}
	}

	async function ingestLibrary() {
		ingestBusy = true;
		ingestNotice = null;
		validationErrors = [];

		try {
			const response = await fetch('/api/session/library', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ format: libraryFormat, content: libraryDraft })
			});
			const body = (await response.json()) as {
				session: ImportSessionSummary | null;
				validationErrors: LibraryRowValidationError[];
			};

			validationErrors = body.validationErrors ?? [];

			if (body.session) {
				applySession(body.session);
				ingestNotice = {
					key: 'library.ingestOk',
					pluralCount: body.session.trackCount
				};
			} else {
				ingestNotice = { key: 'library.ingestNoValid' };
			}
		} catch (error) {
			console.error('[+page] Failed to ingest Source Library', error);
			ingestNotice = { key: 'library.ingestFailed' };
		} finally {
			ingestBusy = false;
		}
	}

	function onLocaleChange(event: Event) {
		const next = (event.currentTarget as HTMLSelectElement).value as AppLocale;
		setLocale(next);
	}

	function trackMenuEntries(): ContextMenuEntry[] {
		return [
			{ type: 'item', id: 'copy-artist', label: t('menu.copyArtist') },
			{ type: 'item', id: 'copy-title', label: t('menu.copyTitle') },
			{ type: 'separator' },
			{ type: 'item', id: 'copy-line', label: t('menu.copyLine') }
		];
	}

	function onTrackMenuSelect(track: LibraryTrack, id: string) {
		const text =
			id === 'copy-artist'
				? track.artist
				: id === 'copy-title'
					? track.title
					: `${track.artist} — ${track.title}`;
		void navigator.clipboard.writeText(text).catch((error) => {
			console.error('[+page] Failed to copy Library Track text', error);
		});
	}
</script>

<div
	class="min-h-screen w-full bg-[radial-gradient(1100px_520px_at_12%_-10%,#9fd0c8_0%,transparent_55%),radial-gradient(900px_480px_at_100%_0%,#b7c7e8_0%,transparent_48%),linear-gradient(160deg,#e8eef4_0%,#d9e3ea_45%,#cfd9e2_100%)] font-shell text-slate-900"
>
	<div class="shell-frame">
		<header class="shell-header">
			<div class="shell-header-row">
				<p class="shell-brand">vk-sc-import</p>
				<label class="grid gap-1 text-xs text-slate-600">
					<span class="font-medium tracking-wide uppercase">{t('locale.switcherLabel')}</span>
					<select
						class="ui-control rounded-lg border border-slate-900/15 bg-white/80 px-2.5 py-1.5 text-sm text-slate-900"
						value={locale}
						onchange={onLocaleChange}
					>
						<option value="ru">{t('locale.ru')}</option>
						<option value="en">{t('locale.en')}</option>
					</select>
				</label>
			</div>
			<p class="shell-tagline">{t('brand.tagline')}</p>
		</header>

		<div class="shell-panel ui-enter">
			<div class="shell-intro">
				<h1>{guidance.headline}</h1>
				<p>{guidance.summary}</p>
			</div>

			<ol class="shell-steps">
				{#each guidance.steps as step (step.id)}
					<li
						class="ui-step rounded-xl border border-slate-900/10 bg-white/80 px-4 py-3.5"
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
								{step.status === 'done' ? t('status.done') : t('status.needed')}
							</span>
						</div>
						<p class="mt-2 text-[0.95rem] leading-snug text-slate-600">{step.detail}</p>

						{#if step.id === 'connect-soundcloud' && step.status === 'needed'}
							<button
								type="button"
								class="ui-btn ui-btn-muted mt-3 inline-flex cursor-not-allowed items-center gap-2 rounded-lg border px-3.5 py-2 text-sm"
								disabled
							>
								{step.title}
								<span class="text-[0.68rem] tracking-wider uppercase opacity-70"
									>{t('status.soon')}</span
								>
							</button>
						{/if}

						{#if step.id === 'load-source-library'}
							{#if sessionSummary}
								<div
									class="ui-fade-in mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
								>
									<p class="m-0 font-medium text-slate-900">
										{withPlural('library.tracksLoaded', sessionSummary.trackCount)}
									</p>
									{#if sessionSummary.sample.length > 0}
										<ul class="mt-2 grid list-none gap-1 p-0 text-[0.9rem] text-slate-600">
											{#each sessionSummary.sample as track (track.artist + '::' + track.title)}
												<li
													class="ui-menu-target rounded-md px-1.5 py-1"
													use:contextMenu={{
														getEntries: trackMenuEntries,
														onSelect: (id) => onTrackMenuSelect(track, id)
													}}
												>
													<span class="font-medium text-slate-800">{track.artist}</span>
													— {track.title}
												</li>
											{/each}
											{#if sessionSummary.trackCount > sessionSummary.sample.length}
												<li class="text-slate-500">
													{t('library.andMore', {
														count: sessionSummary.trackCount - sessionSummary.sample.length
													})}
												</li>
											{/if}
										</ul>
									{/if}
								</div>
							{/if}

							<div class="mt-3 grid gap-2.5">
								<label class="grid gap-1 text-sm text-slate-700">
									<span class="font-medium text-slate-800">{t('library.format')}</span>
									<select
										class="ui-control w-full rounded-lg border border-slate-900/15 bg-white px-3 py-2 text-slate-900"
										bind:value={libraryFormat}
									>
										<option value="json">JSON</option>
										<option value="csv">CSV</option>
									</select>
								</label>

								<label class="grid gap-1 text-sm text-slate-700">
									<span class="font-medium text-slate-800">{t('library.upload')}</span>
									<input
										type="file"
										accept=".json,.csv,application/json,text/csv,text/plain"
										class="ui-file text-sm text-slate-600"
										onchange={onFileChosen}
									/>
								</label>

								<label class="grid gap-1 text-sm text-slate-700">
									<span class="font-medium text-slate-800">{t('library.paste')}</span>
									<textarea
										class="ui-textarea min-h-28 w-full rounded-lg border border-slate-900/15 bg-white px-3 py-2 font-mono text-[0.85rem] text-slate-900"
										placeholder={libraryFormat === 'json'
											? '[{"artist":"Artist","title":"Title"}]'
											: 'artist,title\nArtist,Title'}
										bind:value={libraryDraft}></textarea>
								</label>

								<button
									type="button"
									class="ui-btn ui-btn-primary inline-flex w-full items-center justify-center rounded-lg border border-teal-800/25 bg-teal-700 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
									disabled={ingestBusy || libraryDraft.trim() === ''}
									onclick={ingestLibrary}
								>
									{ingestBusy ? t('library.loading') : t('library.load')}
								</button>

								{#if ingestMessage}
									<p class="ui-fade-in m-0 text-sm text-slate-600" role="status">{ingestMessage}</p>
								{/if}

								{#if validationErrors.length > 0}
									<div
										class="ui-fade-in rounded-lg border border-amber-700/20 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
										role="status"
									>
										<p class="m-0 font-medium">
											{withPlural('library.rowsSkipped', validationErrors.length)}
										</p>
										<ul class="mt-1.5 grid list-none gap-1 p-0 text-[0.9rem]">
											{#each validationErrors.slice(0, 8) as error (error.row + error.message)}
												<li>
													{t('library.rowLabel', { row: error.row })}: {translateValidationCode(
														error.message
													)}
													{#if error.artist !== undefined || error.title !== undefined}
														({error.artist ?? ''} / {error.title ?? ''})
													{/if}
												</li>
											{/each}
											{#if validationErrors.length > 8}
												<li>
													{t('library.andMore', { count: validationErrors.length - 8 })}
												</li>
											{/if}
										</ul>
									</div>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ol>

			{#if guidance.readyToMatch}
				<p
					class="ui-fade-in mt-5 rounded-lg bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
					role="status"
				>
					{t('guidance.readyBanner')}
				</p>
			{/if}
		</div>
	</div>
</div>
