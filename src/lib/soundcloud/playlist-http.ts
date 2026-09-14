/**
 * Injectable SoundCloud playlist + likes HTTP boundary.
 *
 * Real implementation uses `fetch` against api.soundcloud.com. Seam tests for
 * Import Playlist write inject a fake SoundCloudGateway instead — this module
 * is for the live gateway only. Maps playlist DTOs → domain ImportPlaylist
 * here so Import Session never sees snake_case API fields.
 *
 * Playlist membership uses PUT with the full ordered `tracks` list (SoundCloud
 * replace semantics). Track refs use URN form (`soundcloud:tracks:{id}`) —
 * numeric `id` fields fail for newer catalog tracks.
 *
 * Likes: paginated `GET /me/likes/tracks` with linked partitioning so
 * already-on-SC (`alreadyOnSc`) can be detected without writing to likes.
 * v1 presence is likes-only — the practical proxy for “already on my
 * SoundCloud” for a likes-import tool.
 */

import type { ImportPlaylist } from './import-playlist';
import type { SoundCloudOAuthConfig } from './oauth-config';

/** SoundCloud playlist create/get body fields we read. */
export type SoundCloudPlaylistApiDto = {
	id?: number | string;
	urn?: string;
	title?: string;
	permalink_url?: string;
};

export type SoundCloudPlaylistHttp = {
	createPlaylist(accessToken: string, title: string): Promise<ImportPlaylist>;
	setPlaylistTracks(
		accessToken: string,
		playlistId: string,
		trackIds: string[]
	): Promise<void>;
	listLikedTrackIds(accessToken: string): Promise<string[]>;
};

const LIKES_PAGE_LIMIT = 200;

export function createSoundCloudPlaylistHttp(
	config: Pick<SoundCloudOAuthConfig, 'apiBaseUrl'>
): SoundCloudPlaylistHttp {
	return {
		async createPlaylist(accessToken, title) {
			const response = await fetch(`${config.apiBaseUrl}/playlists`, {
				method: 'POST',
				headers: {
					accept: 'application/json; charset=utf-8',
					authorization: `OAuth ${accessToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					playlist: {
						title,
						sharing: 'private',
						tracks: []
					}
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`SoundCloud create playlist failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
				);
			}

			const payload = (await response.json()) as SoundCloudPlaylistApiDto;
			const playlist = mapPlaylistDto(payload);
			if (!playlist) {
				throw new Error('SoundCloud create playlist returned an unreadable playlist');
			}
			return playlist;
		},

		async setPlaylistTracks(accessToken, playlistId, trackIds) {
			const urn = playlistUrn(playlistId);
			const response = await fetch(`${config.apiBaseUrl}/playlists/${encodeURIComponent(urn)}`, {
				method: 'PUT',
				headers: {
					accept: 'application/json; charset=utf-8',
					authorization: `OAuth ${accessToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					playlist: {
						tracks: trackIds.map((trackId) => ({ urn: trackUrn(trackId) }))
					}
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`SoundCloud set playlist tracks failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
				);
			}
		},

		async listLikedTrackIds(accessToken) {
			const ids: string[] = [];
			let nextUrl: string | null =
				`${config.apiBaseUrl}/me/likes/tracks?limit=${LIKES_PAGE_LIMIT}&linked_partitioning=true`;

			while (nextUrl) {
				const response = await fetch(nextUrl, {
					headers: {
						accept: 'application/json; charset=utf-8',
						authorization: `OAuth ${accessToken}`
					}
				});

				if (!response.ok) {
					const text = await response.text().catch(() => '');
					throw new Error(
						`SoundCloud list likes failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
					);
				}

				const payload = (await response.json()) as unknown;
				const rows = collectionRows(payload);
				for (const row of rows) {
					const id = trackIdFromLikeRow(row);
					if (id) {
						ids.push(id);
					}
				}
				nextUrl = nextHref(payload);
			}

			return ids;
		}
	};
}

function mapPlaylistDto(dto: SoundCloudPlaylistApiDto): ImportPlaylist | null {
	const id = playlistIdFromDto(dto);
	const title = dto.title;
	if (!id || typeof title !== 'string' || !title.trim()) {
		return null;
	}
	return {
		id,
		title,
		...(typeof dto.permalink_url === 'string' ? { permalinkUrl: dto.permalink_url } : {})
	};
}

function playlistIdFromDto(dto: SoundCloudPlaylistApiDto): string | null {
	if (typeof dto.urn === 'string' && dto.urn.includes(':')) {
		const parts = dto.urn.split(':');
		const last = parts[parts.length - 1];
		if (last) {
			return last;
		}
	}
	if (typeof dto.id === 'number' || typeof dto.id === 'string') {
		return String(dto.id);
	}
	return null;
}

function trackUrn(trackId: string): string {
	if (trackId.startsWith('soundcloud:tracks:')) {
		return trackId;
	}
	return `soundcloud:tracks:${trackId}`;
}

function playlistUrn(playlistId: string): string {
	if (playlistId.startsWith('soundcloud:playlists:')) {
		return playlistId;
	}
	return `soundcloud:playlists:${playlistId}`;
}

function collectionRows(payload: unknown): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (
		payload !== null &&
		typeof payload === 'object' &&
		Array.isArray((payload as { collection?: unknown }).collection)
	) {
		return (payload as { collection: unknown[] }).collection;
	}
	return [];
}

function nextHref(payload: unknown): string | null {
	if (payload === null || typeof payload !== 'object') {
		return null;
	}
	const href = (payload as { next_href?: unknown }).next_href;
	return typeof href === 'string' && href.trim() ? href : null;
}

function trackIdFromLikeRow(row: unknown): string | null {
	if (row === null || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	// Some like payloads nest the track; others are the track itself.
	const track =
		record.track !== null && typeof record.track === 'object'
			? (record.track as Record<string, unknown>)
			: record;
	if (typeof track.urn === 'string' && track.urn.includes(':')) {
		const parts = track.urn.split(':');
		const last = parts[parts.length - 1];
		if (last) {
			return last;
		}
	}
	if (typeof track.id === 'number' || typeof track.id === 'string') {
		return String(track.id);
	}
	return null;
}
