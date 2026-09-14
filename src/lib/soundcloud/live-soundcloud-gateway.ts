/**
 * Live SoundCloudGateway backed by local auth + catalog/playlist HTTP.
 *
 * Thin adapter: identity/disconnect delegate to SoundCloudAuthApi; search,
 * listen, playlist create/membership, and likes presence use the access token
 * + HTTP modules so Import Session depends on SoundCloudGateway, not on auth
 * file details or raw fetch URLs.
 */

import type { SoundCloudAuthApi } from './soundcloud-auth-api';
import type { SoundCloudCatalogHttp } from './catalog-http';
import type { SoundCloudPlaylistHttp } from './playlist-http';
import type { SoundCloudGateway } from './soundcloud-gateway';

export type CreateLiveSoundCloudGatewayOptions = {
	authApi: SoundCloudAuthApi;
	catalogHttp: SoundCloudCatalogHttp;
	playlistHttp: SoundCloudPlaylistHttp;
};

export function createLiveSoundCloudGateway(
	options: CreateLiveSoundCloudGatewayOptions
): SoundCloudGateway {
	const { authApi, catalogHttp, playlistHttp } = options;

	return {
		async getIdentity() {
			const status = await authApi.getStatus();
			return status.connected ? status.identity : null;
		},

		async disconnect() {
			await authApi.logout();
		},

		async searchTracks(query) {
			const accessToken = await requireAccessToken(authApi, 'catalog search');
			return catalogHttp.searchTracks(accessToken, query);
		},

		async getTrack(trackId) {
			const accessToken = await requireAccessToken(authApi, 'get track');
			return catalogHttp.getTrack(accessToken, trackId);
		},

		async resolveListenMedia(trackId) {
			const accessToken = await requireAccessToken(authApi, 'listen');
			return catalogHttp.resolveListenMedia(accessToken, trackId);
		},

		async createPlaylist(title) {
			const accessToken = await requireAccessToken(authApi, 'create playlist');
			return playlistHttp.createPlaylist(accessToken, title);
		},

		async setPlaylistTracks(playlistId, trackIds) {
			const accessToken = await requireAccessToken(authApi, 'set playlist tracks');
			return playlistHttp.setPlaylistTracks(accessToken, playlistId, trackIds);
		},

		async listLikedTrackIds() {
			const accessToken = await requireAccessToken(authApi, 'list likes');
			return playlistHttp.listLikedTrackIds(accessToken);
		}
	};
}

async function requireAccessToken(
	authApi: SoundCloudAuthApi,
	action: string
): Promise<string> {
	const accessToken = await authApi.getAccessToken();
	if (!accessToken) {
		throw new Error(`SoundCloud ${action} requires a connected account`);
	}
	return accessToken;
}
