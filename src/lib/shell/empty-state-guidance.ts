/**
 * Landing readiness for the shell: which setup steps still block Catalog Match.
 *
 * Copy comes from the UI message catalog so Russian (primary) and English stay
 * aligned. When both steps are done, the page can start Catalog Match — this
 * module still only describes connect + library ingest readiness.
 */

import type { MessageCatalog } from '$lib/i18n/messages';

/** Snapshot of setup flags the landing page uses for empty-state guidance. */
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

/**
 * Maps readiness flags to landing copy and step statuses.
 *
 * Callers must not invent extra steps here (resolve, rematch) — those belong
 * to later Import Session flows once Catalog Match exists.
 */
export function emptyStateGuidance(
	readiness: AppReadiness,
	messages: MessageCatalog
): EmptyStateGuidance {
	const steps: EmptyStateStep[] = [
		{
			id: 'connect-soundcloud',
			title: messages['guidance.stepConnect'],
			detail: messages['guidance.connectDetail'],
			status: readiness.soundCloudConnected ? 'done' : 'needed'
		},
		{
			id: 'load-source-library',
			title: messages['guidance.stepLibrary'],
			detail: messages['guidance.libraryDetail'],
			status: readiness.sourceLibraryLoaded ? 'done' : 'needed'
		}
	];

	const readyToMatch =
		readiness.soundCloudConnected && readiness.sourceLibraryLoaded;

	if (readyToMatch) {
		return {
			headline: messages['guidance.readyHeadline'],
			summary: messages['guidance.readySummary'],
			steps,
			readyToMatch
		};
	}

	if (!readiness.soundCloudConnected && !readiness.sourceLibraryLoaded) {
		return {
			headline: messages['guidance.startHeadline'],
			summary: messages['guidance.startSummary'],
			steps,
			readyToMatch
		};
	}

	if (readiness.soundCloudConnected) {
		return {
			headline: messages['guidance.needLibraryHeadline'],
			summary: messages['guidance.needLibrarySummary'],
			steps,
			readyToMatch
		};
	}

	return {
		headline: messages['guidance.needConnectHeadline'],
		summary: messages['guidance.needConnectSummary'],
		steps,
		readyToMatch
	};
}
