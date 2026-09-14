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
	import type { MatchBucketsSummary } from '$lib/import-session/match-record';
	import MatchResolutionPanel from '$lib/import-session/MatchResolutionPanel.svelte';
	import ReviewRematchPanel from '$lib/import-session/ReviewRematchPanel.svelte';
	import type { LibraryRowValidationError, LibraryTrack } from '$lib/import-session/library-track';
	import type { SourceLibraryFormat } from '$lib/import-session/source-library-ingest';
	import { emptyStateGuidance } from '$lib/shell/empty-state-guidance';
	import type { SoundCloudIdentity } from '$lib/soundcloud/soundcloud-identity';
	import { contextMenu } from '$lib/ui/context-menu-action';
	import type { ContextMenuEntry } from '$lib/ui/context-menu-types';
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	/**
	 * Shell bootstrap: until local SoundCloud + Import Session restores finish,
	 * readiness flags are unknown — showing "needed" steps would lie. Gate the
	 * guidance panel behind pending | ready (not two independent loading bools).
	 */
	let shellBootstrap = $state<'pending' | 'ready'>('pending');

	const readiness = $state({
		soundCloudConnected: false,
		sourceLibraryLoaded: false
	});

	let soundCloudIdentity = $state<SoundCloudIdentity | null>(null);
	let soundCloudBusy = $state(false);
	let soundCloudNotice = $state<MessageKey | null>(null);

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

	let matchBusy = $state(false);
	let matchProgress = $state<{ completed: number; total: number } | null>(null);
	let matchNotice = $state<{
		key: MessageKey;
		params?: Record<string, string | number>;
	} | null>(null);

	let playlistBusy = $state(false);
	let playlistProgress = $state<{ completed: number; total: number } | null>(null);
	let playlistNotice = $state<{
		key: MessageKey;
		params?: Record<string, string | number>;
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
	const matchMessage = $derived(
		matchNotice ? t(matchNotice.key, matchNotice.params, locale) : null
	);
	const playlistMessage = $derived(
		playlistNotice ? t(playlistNotice.key, playlistNotice.params, locale) : null
	);
	const matchResolutionKey = $derived(
		sessionSummary?.matchBuckets
			? [
					sessionSummary.trackCount,
					sessionSummary.matchBuckets.auto,
					sessionSummary.matchBuckets.accepted,
					sessionSummary.matchBuckets.ambiguous,
					sessionSummary.matchBuckets.unresolved,
					sessionSummary.importPlaylist?.id ?? ''
				].join(':')
			: null
	);
	const boundMatchCount = $derived(
		sessionSummary?.matchBuckets
			? sessionSummary.matchBuckets.auto + sessionSummary.matchBuckets.accepted
			: 0
	);
	const canWritePlaylist = $derived(
		boundMatchCount > 0 && sessionSummary?.importPlaylist == null && !matchBusy
	);
	const reviewSessionKey = $derived(
		sessionSummary?.importPlaylist && sessionSummary.matchBuckets
			? [
					sessionSummary.importPlaylist.id,
					sessionSummary.matchBuckets.auto,
					sessionSummary.matchBuckets.accepted
				].join(':')
			: null
	);

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

	async function bootstrapShell() {
		// Parallel restores; one gate so neither finishes into a false empty-state alone.
		await Promise.all([restoreSoundCloud(), restoreSession()]);
		shellBootstrap = 'ready';
	}

	function applyCallbackErrorFromUrl() {
		const params = new SvelteURLSearchParams(window.location.search);
		const scError = params.get('sc_error');
		if (!scError) {
			return;
		}
		if (scError === 'authorize_denied') {
			soundCloudNotice = 'soundcloud.errorAuthorizeDenied';
		} else if (scError === 'missing_code') {
			soundCloudNotice = 'soundcloud.errorMissingCode';
		} else {
			soundCloudNotice = 'soundcloud.errorCompleteFailed';
		}
		params.delete('sc_error');
		const next = params.toString();
		window.history.replaceState({}, '', next ? `/?${next}` : '/');
	}

	async function restoreSoundCloud() {
		try {
			const response = await fetch('/api/soundcloud/status');
			if (!response.ok) {
				soundCloudNotice = 'soundcloud.restoreFailed';
				return;
			}
			const body = (await response.json()) as
				| { connected: false }
				| { connected: true; identity: SoundCloudIdentity };
			applySoundCloudStatus(body);
		} catch (error) {
			console.error('[+page] Failed to restore SoundCloud connection', error);
			soundCloudNotice = 'soundcloud.restoreFailed';
		}
	}

	function applySoundCloudStatus(
		status: { connected: false } | { connected: true; identity: SoundCloudIdentity }
	) {
		soundCloudIdentity = status.connected ? status.identity : null;
		readiness.soundCloudConnected = status.connected;
	}

	async function connectSoundCloud() {
		soundCloudBusy = true;
		soundCloudNotice = null;
		try {
			const response = await fetch('/api/soundcloud/auth/start');
			const body = (await response.json()) as { authorizeUrl?: string; error?: string };
			if (!response.ok || !body.authorizeUrl) {
				soundCloudNotice = 'soundcloud.connectFailed';
				return;
			}
			window.location.assign(body.authorizeUrl);
		} catch (error) {
			console.error('[+page] Failed to start SoundCloud OAuth', error);
			soundCloudNotice = 'soundcloud.connectFailed';
			soundCloudBusy = false;
		}
	}

	async function disconnectSoundCloud() {
		soundCloudBusy = true;
		soundCloudNotice = null;
		try {
			const response = await fetch('/api/soundcloud/logout', { method: 'POST' });
			if (!response.ok) {
				soundCloudNotice = 'soundcloud.logoutFailed';
				return;
			}
			applySoundCloudStatus({ connected: false });
		} catch (error) {
			console.error('[+page] Failed to disconnect SoundCloud', error);
			soundCloudNotice = 'soundcloud.logoutFailed';
		} finally {
			soundCloudBusy = false;
		}
	}

	function applySession(session: ImportSessionSummary | null) {
		sessionSummary = session;
		readiness.sourceLibraryLoaded = session !== null && session.trackCount > 0;
	}


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

	async function runCatalogMatch() {
		matchBusy = true;
		matchNotice = null;
		matchProgress = sessionSummary
			? { completed: 0, total: sessionSummary.trackCount }
			: null;

		try {
			const response = await fetch('/api/session/match', { method: 'POST' });
			if (!response.ok || !response.body) {
				matchNotice = {
					key: 'match.failed',
					params: { message: `HTTP ${response.status}` }
				};
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) {
						continue;
					}
					const event = JSON.parse(trimmed) as
						| {
								type: 'progress';
								completed: number;
								total: number;
						  }
						| {
								type: 'done';
								session: ImportSessionSummary;
								matchBuckets: MatchBucketsSummary;
						  }
						| { type: 'error'; message: string };

					if (event.type === 'progress') {
						matchProgress = {
							completed: event.completed,
							total: event.total
						};
					} else if (event.type === 'done') {
						applySession(event.session);
						matchProgress = {
							completed: event.session.trackCount,
							total: event.session.trackCount
						};
						matchNotice = {
							key: 'match.done',
							params: {
								auto: event.matchBuckets.auto,
								accepted: event.matchBuckets.accepted,
								ambiguous: event.matchBuckets.ambiguous,
								unresolved: event.matchBuckets.unresolved
							}
						};
					} else if (event.type === 'error') {
						matchNotice = {
							key: 'match.failed',
							params: { message: event.message }
						};
					}
				}
			}
		} catch (error) {
			console.error('[+page] Failed to run Catalog Match', error);
			matchNotice = {
				key: 'match.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			matchBusy = false;
		}
	}

	async function writeImportPlaylist() {
		playlistBusy = true;
		playlistNotice = null;
		playlistProgress =
			boundMatchCount > 0 ? { completed: 0, total: boundMatchCount } : null;

		try {
			const response = await fetch('/api/session/playlist', { method: 'POST' });
			if (!response.ok || !response.body) {
				playlistNotice = {
					key: 'playlist.failed',
					params: { message: `HTTP ${response.status}` }
				};
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) {
						continue;
					}
					const event = JSON.parse(trimmed) as
						| {
								type: 'progress';
								completed: number;
								total: number;
						  }
						| {
								type: 'done';
								session: ImportSessionSummary;
								importPlaylist: { id: string; title: string; permalinkUrl?: string };
								writtenCount: number;
								alreadyOnScCount: number;
						  }
						| { type: 'error'; message: string };

					if (event.type === 'progress') {
						playlistProgress = {
							completed: event.completed,
							total: event.total
						};
					} else if (event.type === 'done') {
						applySession(event.session);
						playlistProgress = {
							completed: event.writtenCount,
							total: event.writtenCount
						};
						playlistNotice = {
							key: 'playlist.done',
							params: {
								title: event.importPlaylist.title,
								written: event.writtenCount,
								alreadyOnSc: event.alreadyOnScCount
							}
						};
					} else if (event.type === 'error') {
						playlistNotice = {
							key: 'playlist.failed',
							params: { message: event.message }
						};
					}
				}
			}
		} catch (error) {
			console.error('[+page] Failed to write Import Playlist', error);
			playlistNotice = {
				key: 'playlist.failed',
				params: {
					message: error instanceof Error ? error.message : 'unknown'
				}
			};
		} finally {
			playlistBusy = false;
		}
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
				matchNotice = null;
				matchProgress = null;
				playlistNotice = null;
				playlistProgress = null;
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

	async function clearSourceLibrary() {
		ingestBusy = true;
		ingestNotice = null;
		validationErrors = [];
		try {
			const response = await fetch('/api/session', { method: 'DELETE' });
			if (!response.ok) {
				ingestNotice = { key: 'library.clearFailed' };
				return;
			}
			applySession(null);
			matchNotice = null;
			matchProgress = null;
			playlistNotice = null;
			playlistProgress = null;
			libraryDraft = '';
			ingestNotice = { key: 'library.clearOk' };
		} catch (error) {
			console.error('[+page] Failed to clear Source Library', error);
			ingestNotice = { key: 'library.clearFailed' };
		} finally {
			ingestBusy = false;
		}
	}

	onMount(() => {
		document.documentElement.lang = locale;
		applyCallbackErrorFromUrl();
		void bootstrapShell();
	});
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
			{#if shellBootstrap === 'pending'}
				<div class="shell-intro">
					<h1>{t('shell.restoringHeadline')}</h1>
					<p>{t('shell.restoringSummary')}</p>
				</div>
				<div class="ui-busy ui-fade-in" role="status" aria-live="polite" aria-busy="true">
					<span class="ui-busy-pulse" aria-hidden="true"></span>
					<span>{t('shell.restoring')}</span>
				</div>
			{:else}
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

							{#if step.id === 'connect-soundcloud'}
								{#if step.status === 'done' && soundCloudIdentity}
									<div
										class="ui-fade-in mt-3 flex flex-wrap items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
									>
										<p class="m-0 flex-1 font-medium text-slate-900">
											{t('soundcloud.connectedAs', { username: soundCloudIdentity.username })}
										</p>
										<button
											type="button"
											class="ui-btn ui-btn-muted inline-flex items-center justify-center rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60"
											disabled={soundCloudBusy}
											onclick={disconnectSoundCloud}
										>
											{soundCloudBusy ? t('soundcloud.disconnecting') : t('soundcloud.disconnect')}
										</button>
									</div>
								{:else if step.status === 'needed'}
									<button
										type="button"
										class="ui-btn ui-btn-primary mt-3 inline-flex items-center justify-center rounded-lg border border-teal-800/25 bg-teal-700 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60"
										disabled={soundCloudBusy}
										onclick={connectSoundCloud}
									>
										{soundCloudBusy ? t('soundcloud.connecting') : t('soundcloud.connect')}
									</button>
								{/if}

								{#if soundCloudNotice}
									<p class="ui-fade-in mt-2 m-0 text-sm text-amber-900" role="status">
										{t(soundCloudNotice)}
									</p>
								{/if}
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
										<button
											type="button"
											class="ui-btn ui-btn-muted mt-2.5 inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
											disabled={ingestBusy || matchBusy}
											onclick={clearSourceLibrary}
										>
											{ingestBusy ? t('library.clearing') : t('library.clear')}
										</button>
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
					<div
						class="ui-fade-in mt-5 grid gap-3 rounded-lg bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900"
						role="status"
					>
						<p class="m-0">{t('guidance.readyBanner')}</p>

						{#if sessionSummary?.matchBuckets}
							<p class="m-0 text-emerald-800">
								{t('match.buckets', {
									auto: sessionSummary.matchBuckets.auto,
									accepted: sessionSummary.matchBuckets.accepted,
									ambiguous: sessionSummary.matchBuckets.ambiguous,
									unresolved: sessionSummary.matchBuckets.unresolved
								})}
							</p>
						{/if}

						<button
							type="button"
							class="ui-btn ui-btn-primary inline-flex w-full items-center justify-center rounded-lg border border-teal-800/25 bg-teal-700 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
							disabled={matchBusy}
							onclick={runCatalogMatch}
						>
							{matchBusy ? t('match.running') : t('match.run')}
						</button>

						{#if matchBusy && matchProgress}
							<div class="ui-busy" aria-live="polite" aria-busy="true">
								<span class="ui-busy-pulse" aria-hidden="true"></span>
								<span>
									{t('match.progress', {
										completed: matchProgress.completed,
										total: matchProgress.total
									})}
								</span>
							</div>
						{/if}

						{#if matchMessage}
							<p class="ui-fade-in m-0 text-emerald-900" role="status">{matchMessage}</p>
						{/if}
					</div>
				{/if}

				<MatchResolutionPanel
					sessionKey={matchResolutionKey}
					onSessionChange={applySession}
				/>

				{#if canWritePlaylist || sessionSummary?.importPlaylist || playlistBusy || playlistMessage}
					<div
						class="ui-fade-in mt-5 grid gap-3 rounded-lg border border-slate-900/10 bg-white/85 px-3.5 py-3 text-sm text-slate-800"
						role="status"
					>
						{#if sessionSummary?.importPlaylist}
							<p class="m-0 text-emerald-800">
								{t('playlist.written', { title: sessionSummary.importPlaylist.title })}
								{#if sessionSummary.importPlaylist.permalinkUrl}
									—
									<a
										class="text-teal-800 underline"
										href={sessionSummary.importPlaylist.permalinkUrl}
										target="_blank"
										rel="noreferrer"
									>
										SoundCloud
									</a>
								{/if}
							</p>
						{:else if canWritePlaylist}
							<button
								type="button"
								class="ui-btn ui-btn-primary inline-flex w-full items-center justify-center rounded-lg border border-teal-800/25 bg-teal-700 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
								disabled={playlistBusy}
								onclick={writeImportPlaylist}
							>
								{playlistBusy ? t('playlist.writing') : t('playlist.write')}
							</button>
						{/if}

						{#if playlistBusy && playlistProgress}
							<div class="ui-busy" aria-live="polite" aria-busy="true">
								<span class="ui-busy-pulse" aria-hidden="true"></span>
								<span>
									{t('playlist.progress', {
										completed: playlistProgress.completed,
										total: playlistProgress.total
									})}
								</span>
							</div>
						{/if}

						{#if playlistMessage}
							<p class="ui-fade-in m-0 text-emerald-900" role="status">{playlistMessage}</p>
						{/if}
					</div>
				{/if}

				<ReviewRematchPanel sessionKey={reviewSessionKey} onSessionChange={applySession} />
			{/if}
		</div>
	</div>
</div>
