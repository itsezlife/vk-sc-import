import { describe, expect, it, vi } from 'vitest';
import {
	catalogArtworkUrl,
	isBrowserPlayablePreviewUrl,
	listenMediaCandidateFromStreams,
	progressivePreviewUrlFromStreams,
	resolveBrowserPlayableMediaUrl,
	trackFromApiDto,
	trackStreamsPath
} from './catalog-http';
import { formatTrackDuration } from './soundcloud-track';

/**
 * Feedback loop for in-app listen: browser `<audio>` needs a CDN URL that
 * loads without OAuth. api.soundcloud.com/.../http-preview still needs the
 * Authorization header — handing it to <audio> yields 0:00/0:00.
 */
describe('SoundCloud catalog preview / streams', () => {
	it('maps duration and artwork into domain SoundCloudTrack', () => {
		const track = trackFromApiDto({
			id: 42,
			title: 'Xtal',
			permalink_url: 'https://soundcloud.com/aphex/xtal',
			duration: 291000,
			artwork_url: 'https://i1.sndcdn.com/artworks-xtal-large.jpg',
			user: { username: 'Aphex Twin' }
		});

		expect(track).toEqual({
			id: '42',
			title: 'Xtal',
			artist: 'Aphex Twin',
			permalinkUrl: 'https://soundcloud.com/aphex/xtal',
			durationMs: 291000,
			artworkUrl: 'https://i1.sndcdn.com/artworks-xtal-t300x300.jpg'
		});
	});

	it('falls back to uploader avatar when artwork is missing', () => {
		expect(
			catalogArtworkUrl(null, 'https://i1.sndcdn.com/avatars-user-large.jpg')
		).toBe('https://i1.sndcdn.com/avatars-user-t300x300.jpg');
	});

	it('does not treat OAuth-gated stream_url as a browser-playable previewUrl', () => {
		const track = trackFromApiDto({
			id: 42,
			title: 'Xtal',
			permalink_url: 'https://soundcloud.com/aphex/xtal',
			stream_url: 'https://api.soundcloud.com/tracks/42/stream',
			user: { username: 'Aphex Twin' }
		});

		expect(track).toEqual({
			id: '42',
			title: 'Xtal',
			artist: 'Aphex Twin',
			permalinkUrl: 'https://soundcloud.com/aphex/xtal'
		});
		expect(track && 'previewUrl' in track && track.previewUrl).toBeFalsy();
	});

	it('marks api.soundcloud.com preview gateways as not browser-playable', () => {
		expect(
			isBrowserPlayablePreviewUrl(
				'https://api.soundcloud.com/tracks/soundcloud:tracks:3419282/streams/abc/http-preview'
			)
		).toBe(false);
		expect(
			isBrowserPlayablePreviewUrl(
				'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?Policy=1'
			)
		).toBe(true);
	});

	it('prefers full HLS AAC over progressive preview for Match Resolution listen', () => {
		expect(
			listenMediaCandidateFromStreams({
				preview_mp3_128_url: 'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1',
				http_mp3_128_url: 'https://cf-media.sndcdn.com/x.128.mp3?sig=2',
				hls_aac_160_url: 'https://playback.example/playlist.m3u8'
			})
		).toEqual({
			url: 'https://playback.example/playlist.m3u8',
			kind: 'hls'
		});
	});

	it('falls back to progressive full MP3, then ~30s preview snippet', () => {
		expect(
			listenMediaCandidateFromStreams({
				http_mp3_128_url: 'https://cf-media.sndcdn.com/x.128.mp3?sig=2',
				preview_mp3_128_url: 'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1'
			})
		).toEqual({
			url: 'https://cf-media.sndcdn.com/x.128.mp3?sig=2',
			kind: 'progressive'
		});
		expect(
			listenMediaCandidateFromStreams({
				preview_mp3_128_url: 'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1'
			})
		).toEqual({
			url: 'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1',
			kind: 'progressive'
		});
	});

	it('progressivePreviewUrlFromStreams still prefers the short snippet for MP3-only callers', () => {
		expect(
			progressivePreviewUrlFromStreams({
				preview_mp3_128_url: 'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1',
				http_mp3_128_url: 'https://cf-media.sndcdn.com/x.128.mp3?sig=2',
				hls_aac_160_url: 'https://playback.example/playlist.m3u8'
			})
		).toBe('https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1');
	});

	it('builds the official /streams path from a numeric track id', () => {
		expect(trackStreamsPath('42')).toBe('/tracks/soundcloud:tracks:42/streams');
		expect(trackStreamsPath('soundcloud:tracks:99')).toBe(
			'/tracks/soundcloud:tracks:99/streams'
		);
	});

	it('follows OAuth-gated http-preview redirect to a CDN URL for <audio>', async () => {
		const gateway =
			'https://api.soundcloud.com/tracks/soundcloud:tracks:3419282/streams/abc/http-preview';
		const cdn =
			'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?Policy=1&Signature=2';

		const fetchImpl = vi.fn(async () => {
			return new Response(null, {
				status: 302,
				headers: { location: cdn }
			});
		});

		await expect(
			resolveBrowserPlayableMediaUrl('test-token', gateway, fetchImpl as typeof fetch)
		).resolves.toBe(cdn);

		expect(fetchImpl).toHaveBeenCalledWith(
			gateway,
			expect.objectContaining({
				redirect: 'manual',
				headers: expect.objectContaining({
					authorization: 'OAuth test-token'
				})
			})
		);
	});

	it('returns CDN URLs without an extra hop', async () => {
		const cdn = 'https://cf-preview-media.sndcdn.com/preview/0/30/x.128.mp3?sig=1';
		const fetchImpl = vi.fn();
		await expect(
			resolveBrowserPlayableMediaUrl('test-token', cdn, fetchImpl as typeof fetch)
		).resolves.toBe(cdn);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('formats track duration as m:ss / h:mm:ss', () => {
		expect(formatTrackDuration(0)).toBe('0:00');
		expect(formatTrackDuration(291000)).toBe('4:51');
		expect(formatTrackDuration(3_661_000)).toBe('1:01:01');
	});
});
