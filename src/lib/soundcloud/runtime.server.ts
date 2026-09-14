/**
 * Process-wide SoundCloud auth API for SvelteKit routes (server-only).
 *
 * Auth file lives under `.data/` in the project cwd. Seam tests build their own
 * API with an isolated dataDir / fake oauthHttp — they must not call this
 * singleton.
 *
 * Reads credentials from `$env/dynamic/private` (Vite-loaded `.env`). Plain
 * `process.env` does not see those keys in SvelteKit, which is why Connect
 * looked “unconfigured” even with SOUNDCLOUD_CLIENT_ID set.
 */

import { env } from '$env/dynamic/private';
import { join } from 'node:path';
import { createSoundCloudAuthTokenStore } from './auth-token-store';
import { createSoundCloudCatalogHttp } from './catalog-http';
import { loadSoundCloudOAuthConfig } from './oauth-config';
import { createSoundCloudOAuthHttp } from './oauth-http';
import { createSoundCloudPlaylistHttp } from './playlist-http';
import {
	createSoundCloudAuthApi,
	type SoundCloudAuthApi
} from './soundcloud-auth-api';
import { createLiveSoundCloudGateway } from './live-soundcloud-gateway';
import type { SoundCloudGateway } from './soundcloud-gateway';

const DEFAULT_DATA_DIR = join(process.cwd(), '.data');

let runtimeAuthApi: SoundCloudAuthApi | undefined;
let runtimeGateway: SoundCloudGateway | undefined;

export function getRuntimeSoundCloudAuthApi(): SoundCloudAuthApi {
	if (!runtimeAuthApi) {
		const config = loadSoundCloudOAuthConfig({
			SOUNDCLOUD_CLIENT_ID: env.SOUNDCLOUD_CLIENT_ID,
			SOUNDCLOUD_CLIENT_SECRET: env.SOUNDCLOUD_CLIENT_SECRET,
			SOUNDCLOUD_REDIRECT_URI: env.SOUNDCLOUD_REDIRECT_URI
		});
		runtimeAuthApi = createSoundCloudAuthApi({
			config,
			tokenStore: createSoundCloudAuthTokenStore(DEFAULT_DATA_DIR),
			oauthHttp: createSoundCloudOAuthHttp(config)
		});
	}
	return runtimeAuthApi;
}

export function getRuntimeSoundCloudGateway(): SoundCloudGateway {
	if (!runtimeGateway) {
		const config = loadSoundCloudOAuthConfig({
			SOUNDCLOUD_CLIENT_ID: env.SOUNDCLOUD_CLIENT_ID,
			SOUNDCLOUD_CLIENT_SECRET: env.SOUNDCLOUD_CLIENT_SECRET,
			SOUNDCLOUD_REDIRECT_URI: env.SOUNDCLOUD_REDIRECT_URI
		});
		runtimeGateway = createLiveSoundCloudGateway({
			authApi: getRuntimeSoundCloudAuthApi(),
			catalogHttp: createSoundCloudCatalogHttp(config),
			playlistHttp: createSoundCloudPlaylistHttp(config)
		});
	}
	return runtimeGateway;
}
