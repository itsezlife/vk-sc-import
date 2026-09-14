/**
 * In-memory SoundCloudGateway for seam tests.
 *
 * `connectAs` / `setCatalog` / `setLikedTrackIds` are test-only setup (not part
 * of the port) so suites can simulate a logged-in user, a fake catalog, and
 * library presence without OAuth or network. Production code must not call
 * those helpers.
 *
 * Search matches catalog rows whose normalized artist+title contain every
 * query token (simple substring bag) — enough for classification fixtures
 * without reimplementing the scorer.
 *
 * `resolveListenMedia` returns a track's `previewUrl` as progressive (or HLS
 * when the URL looks like a playlist) when present on the in-memory catalog.
 *
 * Playlist helpers keep an in-memory membership map so Import Playlist write
 * seam tests can assert create/add via `calls` and `playlistTrackIds`.
 */

import type { ImportPlaylist } from './import-playlist';
import type { ListenMedia } from './listen-media';
import { listenMediaKindFromUrl } from './listen-media';
import type { SoundCloudIdentity } from './soundcloud-identity';
import type { SoundCloudGateway } from './soundcloud-gateway';
import type { SoundCloudTrack } from './soundcloud-track';

export type FakeSoundCloudGateway = SoundCloudGateway & {
	connectAs(identity: SoundCloudIdentity): void;
	/** Replace the in-memory catalog used by `searchTracks`. */
	setCatalog(tracks: SoundCloudTrack[]): void;
	/** Replace the in-memory liked-track set used by `listLikedTrackIds`. */
	setLikedTrackIds(trackIds: string[]): void;
	/** Current ordered track ids for a playlist created via `createPlaylist`. */
	playlistTrackIds(playlistId: string): string[];
	/** Ordered log of port method names for search/playlist assertions. */
	readonly calls: string[];
};

export function createFakeSoundCloudGateway(): FakeSoundCloudGateway {
	let identity: SoundCloudIdentity | null = null;
	let catalog: SoundCloudTrack[] = [];
	let likedTrackIds = new Set<string>();
	const playlists = new Map<string, { title: string; trackIds: string[] }>();
	let nextPlaylistSeq = 1;
	const calls: string[] = [];

	return {
		get calls() {
			return calls;
		},

		connectAs(next) {
			identity = next;
		},

		setCatalog(tracks) {
			catalog = [...tracks];
		},

		setLikedTrackIds(trackIds) {
			likedTrackIds = new Set(trackIds);
		},

		playlistTrackIds(playlistId) {
			return [...(playlists.get(playlistId)?.trackIds ?? [])];
		},

		async getIdentity() {
			calls.push('getIdentity');
			return identity;
		},

		async disconnect() {
			calls.push('disconnect');
			identity = null;
		},

		async searchTracks(query) {
			calls.push('searchTracks');
			const tokens = query
				.toLowerCase()
				.split(/\s+/)
				.map((token) => token.trim())
				.filter(Boolean);
			if (tokens.length === 0) {
				return [];
			}
			return catalog.filter((track) => {
				const haystack = `${track.artist} ${track.title}`.toLowerCase();
				return tokens.every((token) => haystack.includes(token));
			});
		},

		async getTrack(trackId) {
			calls.push('getTrack');
			return catalog.find((row) => row.id === trackId) ?? null;
		},

		async resolveListenMedia(trackId): Promise<ListenMedia | null> {
			calls.push('resolveListenMedia');
			const track = catalog.find((row) => row.id === trackId);
			const url = track?.previewUrl;
			if (!url) {
				return null;
			}
			return { url, kind: listenMediaKindFromUrl(url) };
		},

		async createPlaylist(title): Promise<ImportPlaylist> {
			calls.push('createPlaylist');
			requireConnected(identity);
			const id = `pl-${nextPlaylistSeq}`;
			nextPlaylistSeq += 1;
			playlists.set(id, { title, trackIds: [] });
			return {
				id,
				title,
				permalinkUrl: `https://soundcloud.com/writer/sets/${id}`
			};
		},

		async setPlaylistTracks(playlistId, trackIds) {
			calls.push('setPlaylistTracks');
			requireConnected(identity);
			const playlist = playlists.get(playlistId);
			if (!playlist) {
				throw new Error(`Unknown playlist ${playlistId}`);
			}
			playlist.trackIds = [...trackIds];
		},

		async listLikedTrackIds() {
			calls.push('listLikedTrackIds');
			requireConnected(identity);
			return [...likedTrackIds];
		}
	};
}

function requireConnected(identity: SoundCloudIdentity | null): void {
	if (!identity) {
		throw new Error('SoundCloudGateway requires a connected account');
	}
}
