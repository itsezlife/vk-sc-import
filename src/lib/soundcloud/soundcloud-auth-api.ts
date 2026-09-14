/**
 * SoundCloud auth API — local OAuth 2.1 + PKCE orchestration seam.
 *
 * Routes and seam tests share this contract. Owns: start login (authorize URL +
 * pending PKCE), complete login (code exchange + /me), status for the UI, and
 * logout (clear local tokens; best-effort remote sign-out).
 *
 * Does not own: catalog search scoring, playlists, Import Session. Tokens never
 * appear in status JSON — only non-secret SoundCloudIdentity. `getAccessToken`
 * is for SoundCloudGateway catalog calls on the server — never exposed to the
 * browser.
 *
 * Invariants:
 * - `completeLogin` rejects mismatched `state` (CSRF).
 * - Failed complete does not clear an existing successful token file.
 * - `startLogin` replaces pending only; existing tokens stay until complete succeeds
 *   or the user logs out.
 * - `getStatus` / `getAccessToken` are disconnected/null when tokens are missing
 *   or `expiresAt` is past (refresh lands with catalog API usage — complexity
 *   on demand).
 */

import { randomBytes } from 'node:crypto';
import {
	SOUNDCLOUD_AUTH_FILE_VERSION,
	type SoundCloudAuthTokenStore
} from './auth-token-store';
import type { SoundCloudOAuthConfig } from './oauth-config';
import {
	identityFromMeDto,
	tokenSetFromResponse,
	type SoundCloudOAuthHttp
} from './oauth-http';
import { createPkcePair, toBase64Url } from './pkce';
import type { SoundCloudIdentity } from './soundcloud-identity';

export type SoundCloudAuthStatus =
	| { connected: false }
	| { connected: true; identity: SoundCloudIdentity };

export type StartLoginResult = {
	authorizeUrl: string;
};

export type CompleteLoginInput = {
	code: string;
	state: string;
};

export type SoundCloudAuthApi = {
	startLogin(): Promise<StartLoginResult>;
	completeLogin(input: CompleteLoginInput): Promise<SoundCloudAuthStatus>;
	getStatus(): Promise<SoundCloudAuthStatus>;
	/**
	 * Bearer token for SoundCloudGateway catalog HTTP. Null when disconnected
	 * or expired — same liveness rule as `getStatus`.
	 */
	getAccessToken(): Promise<string | null>;
	logout(): Promise<void>;
};

export type CreateSoundCloudAuthApiOptions = {
	config: SoundCloudOAuthConfig;
	tokenStore: SoundCloudAuthTokenStore;
	oauthHttp: SoundCloudOAuthHttp;
	/** Injectable clock for expiresAt; defaults to Date. */
	now?: () => Date;
};

export function createSoundCloudAuthApi(
	options: CreateSoundCloudAuthApiOptions
): SoundCloudAuthApi {
	const { config, tokenStore, oauthHttp } = options;
	const now = options.now ?? (() => new Date());

	return {
		async startLogin() {
			const pkce = createPkcePair();
			const state = toBase64Url(randomBytes(16));
			const current = await tokenStore.read();

			await tokenStore.write({
				...current,
				version: SOUNDCLOUD_AUTH_FILE_VERSION,
				pending: {
					state,
					codeVerifier: pkce.codeVerifier,
					createdAt: now().toISOString()
				}
			});

			const url = new URL(config.authorizeUrl);
			url.searchParams.set('client_id', config.clientId);
			url.searchParams.set('redirect_uri', config.redirectUri);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('code_challenge', pkce.codeChallenge);
			url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
			url.searchParams.set('state', state);

			return { authorizeUrl: url.toString() };
		},

		async completeLogin(input) {
			const current = await tokenStore.read();
			const pending = current.pending;

			if (!pending || pending.state !== input.state) {
				throw new Error('SoundCloud OAuth state mismatch or missing pending login');
			}

			const tokenResponse = await oauthHttp.exchangeAuthorizationCode({
				code: input.code,
				codeVerifier: pending.codeVerifier
			});
			const tokens = tokenSetFromResponse(tokenResponse, now());
			const me = await oauthHttp.fetchMe(tokens.accessToken);
			const identity = identityFromMeDto(me);

			await tokenStore.write({
				version: SOUNDCLOUD_AUTH_FILE_VERSION,
				pending: null,
				tokens,
				identity
			});

			return { connected: true, identity };
		},

		async getStatus() {
			const current = await tokenStore.read();
			if (!current.tokens || !current.identity) {
				return { connected: false };
			}
			if (Date.parse(current.tokens.expiresAt) <= now().getTime()) {
				return { connected: false };
			}
			return { connected: true, identity: current.identity };
		},

		async getAccessToken() {
			const current = await tokenStore.read();
			if (!current.tokens) {
				return null;
			}
			if (Date.parse(current.tokens.expiresAt) <= now().getTime()) {
				return null;
			}
			return current.tokens.accessToken;
		},

		async logout() {
			const current = await tokenStore.read();
			const accessToken = current.tokens?.accessToken;
			if (accessToken) {
				try {
					await oauthHttp.signOut(accessToken);
				} catch (error) {
					console.error('[soundcloud-auth-api] Remote sign-out failed; clearing local credentials', error);
				}
			}
			await tokenStore.clear();
		}
	};
}
