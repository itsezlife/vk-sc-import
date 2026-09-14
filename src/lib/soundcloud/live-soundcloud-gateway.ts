/**
 * Live SoundCloudGateway backed by local auth + catalog HTTP.
 *
 * Thin adapter: identity/disconnect delegate to SoundCloudAuthApi; search and
 * listen resolve use the access token + catalog HTTP so Catalog Match /
 * Match Resolution depend on SoundCloudGateway, not on auth file details or
 * raw fetch URLs.
 */

import type { SoundCloudAuthApi } from './soundcloud-auth-api';
import type { SoundCloudCatalogHttp } from './catalog-http';
import type { SoundCloudGateway } from './soundcloud-gateway';

export type CreateLiveSoundCloudGatewayOptions = {
	authApi: SoundCloudAuthApi;
	catalogHttp: SoundCloudCatalogHttp;
};

export function createLiveSoundCloudGateway(
	options: CreateLiveSoundCloudGatewayOptions
): SoundCloudGateway {
	const { authApi, catalogHttp } = options;

	return {
		async getIdentity() {
			const status = await authApi.getStatus();
			return status.connected ? status.identity : null;
		},

		async disconnect() {
			await authApi.logout();
		},

		async searchTracks(query) {
			const accessToken = await authApi.getAccessToken();
			if (!accessToken) {
				throw new Error('SoundCloud catalog search requires a connected account');
			}
			return catalogHttp.searchTracks(accessToken, query);
		},

		async getTrack(trackId) {
			const accessToken = await authApi.getAccessToken();
			if (!accessToken) {
				throw new Error('SoundCloud get track requires a connected account');
			}
			return catalogHttp.getTrack(accessToken, trackId);
		},

		async resolveListenMedia(trackId) {
			const accessToken = await authApi.getAccessToken();
			if (!accessToken) {
				throw new Error('SoundCloud listen requires a connected account');
			}
			return catalogHttp.resolveListenMedia(accessToken, trackId);
		}
	};
}
