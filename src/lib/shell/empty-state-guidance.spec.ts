import { describe, expect, it } from 'vitest';
import { emptyStateGuidance } from './empty-state-guidance';

describe('emptyStateGuidance', () => {
	it('explains connecting SoundCloud and loading a Source Library when neither is ready', () => {
		const guidance = emptyStateGuidance({
			soundCloudConnected: false,
			sourceLibraryLoaded: false
		});

		expect(guidance.readyToMatch).toBe(false);
		expect(guidance.headline).toBe('Start your Import Session');
		expect(guidance.summary).toBe(
			'Connect SoundCloud and load a Source Library to catalog-match VK likes into an Import Playlist.'
		);
		expect(guidance.steps).toEqual([
			{
				id: 'connect-soundcloud',
				title: 'Connect SoundCloud',
				detail: 'Sign in so matched tracks can be written to your Import Playlist.',
				status: 'needed'
			},
			{
				id: 'load-source-library',
				title: 'Load Source Library',
				detail: 'Provide your VK likes as a Source Library of artist + title rows.',
				status: 'needed'
			}
		]);
	});

	it('marks SoundCloud done and still asks for a Source Library', () => {
		const guidance = emptyStateGuidance({
			soundCloudConnected: true,
			sourceLibraryLoaded: false
		});

		expect(guidance.readyToMatch).toBe(false);
		expect(guidance.headline).toBe('Load a Source Library');
		expect(guidance.summary).toBe(
			'SoundCloud is connected. Load a Source Library to start catalog matching.'
		);
		expect(guidance.steps.map((step) => [step.id, step.status])).toEqual([
			['connect-soundcloud', 'done'],
			['load-source-library', 'needed']
		]);
	});

	it('marks Source Library done and still asks to connect SoundCloud', () => {
		const guidance = emptyStateGuidance({
			soundCloudConnected: false,
			sourceLibraryLoaded: true
		});

		expect(guidance.readyToMatch).toBe(false);
		expect(guidance.headline).toBe('Connect SoundCloud');
		expect(guidance.summary).toBe(
			'Source Library is loaded. Connect SoundCloud before writing an Import Playlist.'
		);
		expect(guidance.steps.map((step) => [step.id, step.status])).toEqual([
			['connect-soundcloud', 'needed'],
			['load-source-library', 'done']
		]);
	});

	it('reports ready when SoundCloud is connected and a Source Library is loaded', () => {
		const guidance = emptyStateGuidance({
			soundCloudConnected: true,
			sourceLibraryLoaded: true
		});

		expect(guidance.readyToMatch).toBe(true);
		expect(guidance.headline).toBe('Ready to catalog match');
		expect(guidance.summary).toBe(
			'SoundCloud is connected and a Source Library is loaded. Catalog matching comes next.'
		);
		expect(guidance.steps.every((step) => step.status === 'done')).toBe(true);
	});
});
