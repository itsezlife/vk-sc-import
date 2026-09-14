import { describe, expect, it } from 'vitest';
import { createFakeSoundCloudGateway } from './fake-soundcloud-gateway';

/**
 * Seam: SoundCloudGateway fake (identity after connect, logout clears).
 * No live SoundCloud.
 */
describe('SoundCloudGateway fake seam', () => {
	it('returns null identity until connectAs, then clears on disconnect', async () => {
		const gateway = createFakeSoundCloudGateway();

		await expect(gateway.getIdentity()).resolves.toBeNull();

		gateway.connectAs({
			id: '7',
			username: 'tester',
			permalinkUrl: 'https://soundcloud.com/tester'
		});

		await expect(gateway.getIdentity()).resolves.toEqual({
			id: '7',
			username: 'tester',
			permalinkUrl: 'https://soundcloud.com/tester'
		});

		await gateway.disconnect();
		await expect(gateway.getIdentity()).resolves.toBeNull();
		expect(gateway.calls).toEqual([
			'getIdentity',
			'getIdentity',
			'disconnect',
			'getIdentity'
		]);
	});

	it('searchTracks filters the in-memory catalog by query tokens', async () => {
		const gateway = createFakeSoundCloudGateway();
		gateway.setCatalog([
			{ id: '1', artist: 'Aphex Twin', title: 'Xtal' },
			{ id: '2', artist: 'Burial', title: 'Archangel' }
		]);

		await expect(gateway.searchTracks('Aphex Xtal')).resolves.toEqual([
			{ id: '1', artist: 'Aphex Twin', title: 'Xtal' }
		]);
		await expect(gateway.searchTracks('missing forever')).resolves.toEqual([]);
		expect(gateway.calls).toEqual(['searchTracks', 'searchTracks']);
	});

	it('resolveListenMedia returns catalog previewUrl as progressive when present', async () => {
		const gateway = createFakeSoundCloudGateway();
		gateway.setCatalog([
			{
				id: '1',
				artist: 'Aphex Twin',
				title: 'Xtal',
				previewUrl: 'https://cf-preview-media.sndcdn.com/preview/xtal.mp3'
			},
			{ id: '2', artist: 'Burial', title: 'Archangel' }
		]);

		await expect(gateway.resolveListenMedia('1')).resolves.toEqual({
			url: 'https://cf-preview-media.sndcdn.com/preview/xtal.mp3',
			kind: 'progressive'
		});
		await expect(gateway.resolveListenMedia('2')).resolves.toBeNull();
		expect(gateway.calls).toEqual(['resolveListenMedia', 'resolveListenMedia']);
	});
});
