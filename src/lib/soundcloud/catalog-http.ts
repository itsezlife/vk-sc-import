/**
 * Injectable SoundCloud catalog HTTP boundary (search tracks).
 *
 * Real implementation uses `fetch` against api.soundcloud.com. Seam tests for
 * Catalog Match inject a fake SoundCloudGateway instead — this module is for
 * the live gateway only. Maps track DTOs → domain SoundCloudTrack here so
 * Import Session never sees snake_case API fields.
 */

import type { SoundCloudOAuthConfig } from './oauth-config';
import type { SoundCloudTrack } from './soundcloud-track';

/** SoundCloud `/tracks` collection item (fields we actually read). */
export type SoundCloudTrackApiDto = {
	id: number | string;
	title: string;
	permalink_url?: string;
	user?: { username?: string };
	publisher_metadata?: { artist?: string };
};

export type SoundCloudCatalogHttp = {
	searchTracks(accessToken: string, query: string): Promise<SoundCloudTrack[]>;
};

const SEARCH_LIMIT = 10;

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
		}
	};
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
	return {
		id: String(dto.id),
		title: dto.title,
		artist,
		...(dto.permalink_url ? { permalinkUrl: dto.permalink_url } : {})
	};
}
