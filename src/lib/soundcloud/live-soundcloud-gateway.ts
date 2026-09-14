/**
 * Live SoundCloudGateway backed by local auth + catalog HTTP.
 *
 * Thin adapter: identity/disconnect delegate to SoundCloudAuthApi; search uses
 * the access token + catalog HTTP so Catalog Match depends on SoundCloudGateway,
 * not on auth file details or raw fetch URLs.
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
		}
	};
}
