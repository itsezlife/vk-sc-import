/**
 * Injectable SoundCloud catalog HTTP boundary (search tracks + stream resolve).
 *
 * Real implementation uses `fetch` against api.soundcloud.com. Seam tests for
 * Catalog Match inject a fake SoundCloudGateway instead — this module is for
 * the live gateway only. Maps track DTOs → domain SoundCloudTrack here so
 * Import Session never sees snake_case API fields.
 *
 * Listen: `/tracks/{urn}/streams` returns OAuth-gated gateway URLs
 * (`api.soundcloud.com/.../http-preview` or HLS playlists). Browser `<audio>` /
 * hls.js cannot send Authorization. We follow redirects **server-side** with
 * the user token and return signed CDN URLs the client can play without auth.
 * Prefer full-track HLS over the ~30s progressive preview snippet.
 */

import type { ListenMedia } from './listen-media';
import type { SoundCloudOAuthConfig } from './oauth-config';
import type { SoundCloudTrack } from './soundcloud-track';

/** SoundCloud `/tracks` collection item (fields we actually read). */
export type SoundCloudTrackApiDto = {
	id: number | string;
	title: string;
	permalink_url?: string;
	/** Full track length in milliseconds. */
	duration?: number;
	artwork_url?: string | null;
	user?: { username?: string; avatar_url?: string | null };
	publisher_metadata?: { artist?: string };
};

/** SoundCloud `GET /tracks/{urn}/streams` body (fields we actually read). */
export type SoundCloudStreamsApiDto = {
	preview_mp3_128_url?: string;
	http_mp3_128_url?: string;
	hls_mp3_128_url?: string;
	hls_aac_160_url?: string;
	hls_aac_96_url?: string;
};

export type SoundCloudCatalogHttp = {
	searchTracks(accessToken: string, query: string): Promise<SoundCloudTrack[]>;
	/** Single catalog track by id/URN — used to hydrate Session File candidates. */
	getTrack(accessToken: string, trackId: string): Promise<SoundCloudTrack | null>;
	/**
	 * Browser-playable listen media (CDN URL + kind). Prefers full-track HLS,
	 * then progressive full MP3, then ~30s preview. Null when blocked / missing.
	 */
	resolveListenMedia(accessToken: string, trackId: string): Promise<ListenMedia | null>;
};

const SEARCH_LIMIT = 10;
const MAX_MEDIA_REDIRECTS = 5;

export function createSoundCloudCatalogHttp(
	config: Pick<SoundCloudOAuthConfig, 'apiBaseUrl'>
): SoundCloudCatalogHttp {
	return {
		async searchTracks(accessToken, query) {
			const url = new URL(`${config.apiBaseUrl}/tracks`);
			url.searchParams.set('q', query);
			url.searchParams.set('limit', String(SEARCH_LIMIT));
			url.searchParams.set('access', 'playable');

			const response = await fetch(url, {
				headers: {
					accept: 'application/json; charset=utf-8',
					authorization: `OAuth ${accessToken}`
				}
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`SoundCloud track search failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
				);
			}

			const payload = (await response.json()) as unknown;
			const rows = Array.isArray(payload)
				? payload
				: payload !== null &&
					  typeof payload === 'object' &&
					  Array.isArray((payload as { collection?: unknown }).collection)
					? ((payload as { collection: unknown[] }).collection ?? [])
					: [];

			const tracks: SoundCloudTrack[] = [];
			for (const row of rows) {
				const track = trackFromApiDto(row);
				if (track) {
					tracks.push(track);
				}
			}
			return tracks;
		},

		async getTrack(accessToken, trackId) {
			const urn = trackId.startsWith('soundcloud:')
				? trackId
				: `soundcloud:tracks:${trackId}`;
			const url = new URL(`${config.apiBaseUrl}/tracks/${urn}`);
			const response = await fetch(url, {
				headers: {
					accept: 'application/json; charset=utf-8',
					authorization: `OAuth ${accessToken}`
				}
			});

			if (response.status === 404 || response.status === 403) {
				return null;
			}
			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`SoundCloud get track failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
				);
			}

			return trackFromApiDto(await response.json());
		},

		async resolveListenMedia(accessToken, trackId) {
			const url = new URL(`${config.apiBaseUrl}${trackStreamsPath(trackId)}`);
			const response = await fetch(url, {
				headers: {
					accept: 'application/json; charset=utf-8',
					authorization: `OAuth ${accessToken}`
				}
			});

			if (response.status === 404 || response.status === 403) {
				return null;
			}
			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`SoundCloud track streams failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
				);
			}

			const payload = (await response.json()) as SoundCloudStreamsApiDto;
			const candidate = listenMediaCandidateFromStreams(payload);
			if (!candidate) {
				return null;
			}
			const playable = await resolveBrowserPlayableMediaUrl(accessToken, candidate.url);
			if (!playable) {
				return null;
			}
			return { url: playable, kind: candidate.kind };
		}
	};
}

/**
 * Path for `GET /tracks/{urn}/streams`. Accepts bare numeric ids or full URNs.
 */
export function trackStreamsPath(trackId: string): string {
	const urn = trackId.startsWith('soundcloud:')
		? trackId
		: `soundcloud:tracks:${trackId}`;
	return `/tracks/${urn}/streams`;
}

/**
 * True when `<audio src>` can load the URL without an OAuth header.
 * `api.soundcloud.com` stream/preview gateways always need Authorization.
 */
export function isBrowserPlayablePreviewUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.toLowerCase();
		if (host === 'api.soundcloud.com' || host.endsWith('.api.soundcloud.com')) {
			return false;
		}
		return host.length > 0;
	} catch {
		return false;
	}
}

/**
 * Picks the best listen candidate from `/streams` (gateway or CDN URL).
 * Callers must run `resolveBrowserPlayableMediaUrl` before handing to the UI.
 *
 * Order: full HLS AAC → HLS MP3 → progressive full MP3 → ~30s preview snippet.
 */
export function listenMediaCandidateFromStreams(
	dto: SoundCloudStreamsApiDto
): ListenMedia | null {
	const hlsAac =
		dto.hls_aac_160_url?.trim() || dto.hls_aac_96_url?.trim() || null;
	if (hlsAac) {
		return { url: hlsAac, kind: 'hls' };
	}
	const hlsMp3 = dto.hls_mp3_128_url?.trim();
	if (hlsMp3) {
		return { url: hlsMp3, kind: 'hls' };
	}
	const progressive = dto.http_mp3_128_url?.trim();
	if (progressive) {
		return { url: progressive, kind: 'progressive' };
	}
	const preview = dto.preview_mp3_128_url?.trim();
	if (preview) {
		return { url: preview, kind: 'progressive' };
	}
	return null;
}

/**
 * Progressive-only pick (snippet first). Prefer `listenMediaCandidateFromStreams`
 * for Match Resolution listen — kept for tests / callers that need MP3 only.
 */
export function progressivePreviewUrlFromStreams(
	dto: SoundCloudStreamsApiDto
): string | null {
	const preview = dto.preview_mp3_128_url?.trim();
	if (preview) {
		return preview;
	}
	const progressive = dto.http_mp3_128_url?.trim();
	if (progressive) {
		return progressive;
	}
	return null;
}

/**
 * Follows OAuth-gated SoundCloud media redirects (manual, no body download)
 * until a CDN URL suitable for browser `<audio>` is reached.
 */
export async function resolveBrowserPlayableMediaUrl(
	accessToken: string,
	mediaUrl: string,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	let current = mediaUrl;
	for (let hop = 0; hop < MAX_MEDIA_REDIRECTS; hop += 1) {
		if (isBrowserPlayablePreviewUrl(current)) {
			return current;
		}

		const response = await fetchImpl(current, {
			method: 'GET',
			headers: {
				accept: '*/*',
				authorization: `OAuth ${accessToken}`
			},
			redirect: 'manual'
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) {
				return null;
			}
			current = new URL(location, current).href;
			continue;
		}

		if (response.ok && isBrowserPlayablePreviewUrl(response.url)) {
			return response.url;
		}

		// 200 on api.soundcloud.com with audio bytes — still not usable in <audio>.
		return null;
	}
	return isBrowserPlayablePreviewUrl(current) ? current : null;
}

/**
 * Prefer a medium square artwork CDN size for cards. SoundCloud serves
 * `-large` / `-badge` variants that look soft or cropped in a small thumb.
 */
export function catalogArtworkUrl(
	artworkUrl: string | null | undefined,
	avatarUrl?: string | null
): string | undefined {
	const raw = artworkUrl?.trim() || avatarUrl?.trim() || '';
	if (!raw) {
		return undefined;
	}
	return raw
		.replace('-large.', '-t300x300.')
		.replace('-badge.', '-t300x300.')
		.replace('-tiny.', '-t300x300.');
}

/** Maps one API track DTO into domain; returns null when required fields missing. */
export function trackFromApiDto(row: unknown): SoundCloudTrack | null {
	if (row === null || typeof row !== 'object') {
		return null;
	}
	const dto = row as SoundCloudTrackApiDto;
	if (dto.id === undefined || dto.id === null || typeof dto.title !== 'string') {
		return null;
	}
	const artist =
		dto.publisher_metadata?.artist?.trim() ||
		dto.user?.username?.trim() ||
		'';
	if (!artist) {
		return null;
	}
	const artworkUrl = catalogArtworkUrl(dto.artwork_url, dto.user?.avatar_url);
	const durationMs =
		typeof dto.duration === 'number' && Number.isFinite(dto.duration) && dto.duration >= 0
			? dto.duration
			: undefined;
	return {
		id: String(dto.id),
		title: dto.title,
		artist,
		...(dto.permalink_url ? { permalinkUrl: dto.permalink_url } : {}),
		...(artworkUrl ? { artworkUrl } : {}),
		...(durationMs !== undefined ? { durationMs } : {})
	};
}
