/**
 * In-memory SoundCloudGateway for seam tests.
 *
 * `connectAs` / `setCatalog` are test-only setup (not part of the port) so
 * suites can simulate a logged-in user and a fake catalog without OAuth or
 * network. Production code must not call those helpers.
 *
 * Search matches catalog rows whose normalized artist+title contain every
 * query token (simple substring bag) — enough for classification fixtures
 * without reimplementing the scorer.
 *
 * `resolveListenMedia` returns a track's `previewUrl` as progressive (or HLS
 * when the URL looks like a playlist) when present on the in-memory catalog.
 */

import type { ListenMedia } from './listen-media';
import { listenMediaKindFromUrl } from './listen-media';
import type { SoundCloudIdentity } from './soundcloud-identity';
import type { SoundCloudGateway } from './soundcloud-gateway';
import type { SoundCloudTrack } from './soundcloud-track';

export type FakeSoundCloudGateway = SoundCloudGateway & {
	connectAs(identity: SoundCloudIdentity): void;
	/** Replace the in-memory catalog used by `searchTracks`. */
	setCatalog(tracks: SoundCloudTrack[]): void;
	/** Ordered log of port method names for search/playlist assertions. */
	readonly calls: string[];
};

export function createFakeSoundCloudGateway(): FakeSoundCloudGateway {
	let identity: SoundCloudIdentity | null = null;
	let catalog: SoundCloudTrack[] = [];
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
		}
	};
}
