import { describe, expect, it } from 'vitest';
import { catalogs } from '$lib/i18n/messages';
import { emptyStateGuidance } from './empty-state-guidance';

describe('emptyStateGuidance', () => {
	it('explains connecting SoundCloud and loading a Source Library in Russian by default catalog', () => {
		const guidance = emptyStateGuidance(
			{
				soundCloudConnected: false,
				sourceLibraryLoaded: false
			},
			catalogs.ru
		);

		expect(guidance.readyToMatch).toBe(false);
		expect(guidance.headline).toBe(catalogs.ru['guidance.startHeadline']);
		expect(guidance.summary).toBe(catalogs.ru['guidance.startSummary']);
		expect(guidance.steps).toEqual([
			{
				id: 'connect-soundcloud',
				title: catalogs.ru['guidance.stepConnect'],
				detail: catalogs.ru['guidance.connectDetail'],
				status: 'needed'
			},
			{
				id: 'load-source-library',
				title: catalogs.ru['guidance.stepLibrary'],
				detail: catalogs.ru['guidance.libraryDetail'],
				status: 'needed'
			}
		]);
	});

	it('marks SoundCloud done and still asks for a Source Library (en)', () => {
		const guidance = emptyStateGuidance(
			{
				soundCloudConnected: true,
				sourceLibraryLoaded: false
			},
			catalogs.en
		);

		expect(guidance.readyToMatch).toBe(false);
		expect(guidance.headline).toBe(catalogs.en['guidance.needLibraryHeadline']);
		expect(guidance.summary).toBe(catalogs.en['guidance.needLibrarySummary']);
		expect(guidance.steps.map((step) => [step.id, step.status])).toEqual([
			['connect-soundcloud', 'done'],
			['load-source-library', 'needed']
		]);
	});

	it('marks Source Library done and still asks to connect SoundCloud (ru)', () => {
		const guidance = emptyStateGuidance(
			{
				soundCloudConnected: false,
				sourceLibraryLoaded: true
			},
			catalogs.ru
		);

		expect(guidance.readyToMatch).toBe(false);
		expect(guidance.headline).toBe(catalogs.ru['guidance.needConnectHeadline']);
		expect(guidance.summary).toBe(catalogs.ru['guidance.needConnectSummary']);
		expect(guidance.steps.map((step) => [step.id, step.status])).toEqual([
			['connect-soundcloud', 'needed'],
			['load-source-library', 'done']
		]);
	});

	it('reports ready when SoundCloud is connected and a Source Library is loaded (ru)', () => {
		const guidance = emptyStateGuidance(
			{
				soundCloudConnected: true,
				sourceLibraryLoaded: true
			},
			catalogs.ru
		);

		expect(guidance.readyToMatch).toBe(true);
		expect(guidance.headline).toBe(catalogs.ru['guidance.readyHeadline']);
		expect(guidance.summary).toBe(catalogs.ru['guidance.readySummary']);
		expect(guidance.steps.every((step) => step.status === 'done')).toBe(true);
	});
});
