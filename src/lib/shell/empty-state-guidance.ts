/**
 * Landing readiness for the shell: which setup steps still block an Import Session.
 *
 * Without this map, the UI would scatter ad-hoc copy for “not connected” vs “no
 * library” and drift from CONTEXT.md terms (SoundCloud, Source Library, Import
 * Playlist). Auth and ingest land in later issues; this module only describes
 * the two empty states the shell must explain today.
 */

/** Snapshot of setup flags the landing page knows about before OAuth / ingest exist. */
export type AppReadiness = {
	soundCloudConnected: boolean;
	sourceLibraryLoaded: boolean;
};

export type EmptyStateStepId = 'connect-soundcloud' | 'load-source-library';

export type EmptyStateStep = {
	id: EmptyStateStepId;
	title: string;
	detail: string;
	status: 'needed' | 'done';
};

export type EmptyStateGuidance = {
	headline: string;
	summary: string;
	steps: EmptyStateStep[];
	/** True only when both SoundCloud and a Source Library are ready. */
	readyToMatch: boolean;
};

const CONNECT_DETAIL =
	'Sign in so matched tracks can be written to your Import Playlist.';
const LIBRARY_DETAIL =
	'Provide your VK likes as a Source Library of artist + title rows.';

/**
 * Maps readiness flags to landing copy and step statuses.
 *
 * Callers must not invent extra steps here (matching, rematch) — those belong
 * to later Import Session flows once connect + library ingest exist.
 */
export function emptyStateGuidance(readiness: AppReadiness): EmptyStateGuidance {
	const steps: EmptyStateStep[] = [
		{
			id: 'connect-soundcloud',
			title: 'Connect SoundCloud',
			detail: CONNECT_DETAIL,
			status: readiness.soundCloudConnected ? 'done' : 'needed'
		},
		{
			id: 'load-source-library',
			title: 'Load Source Library',
			detail: LIBRARY_DETAIL,
			status: readiness.sourceLibraryLoaded ? 'done' : 'needed'
		}
	];

	const readyToMatch =
		readiness.soundCloudConnected && readiness.sourceLibraryLoaded;

	if (readyToMatch) {
		return {
			headline: 'Ready to catalog match',
			summary:
				'SoundCloud is connected and a Source Library is loaded. Catalog matching comes next.',
			steps,
			readyToMatch
		};
	}

	if (!readiness.soundCloudConnected && !readiness.sourceLibraryLoaded) {
		return {
			headline: 'Start your Import Session',
			summary:
				'Connect SoundCloud and load a Source Library to catalog-match VK likes into an Import Playlist.',
			steps,
			readyToMatch
		};
	}

	if (readiness.soundCloudConnected) {
		return {
			headline: 'Load a Source Library',
			summary:
				'SoundCloud is connected. Load a Source Library to start catalog matching.',
			steps,
			readyToMatch
		};
	}

	return {
		headline: 'Connect SoundCloud',
		summary:
			'Source Library is loaded. Connect SoundCloud before writing an Import Playlist.',
		steps,
		readyToMatch
	};
}
