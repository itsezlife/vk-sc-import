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
 * - `getStatus` / `getAccessToken` refresh tokens that are expired or within
 *   {@link REFRESH_SKEW_MS} of expiry, so long runs (1000-track playlist write)
 *   outlive the ~1h access token. Concurrent callers share one refresh. They
 *   are disconnected/null when tokens are missing or refresh fails (the token
 *   file is kept so the cause can be inspected; reconnect replaces it).
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
import type { SoundCloudTokenSet } from './auth-token-store';

/** Refresh this long before `expiresAt` so a token never dies mid-request. */
const REFRESH_SKEW_MS = 60_000;

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
	 * Bearer token for SoundCloudGateway catalog HTTP, refreshed when near
	 * expiry. Null when disconnected or refresh failed — same liveness rule as
	 * `getStatus`.
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
	let refreshing: Promise<SoundCloudTokenSet | null> | null = null;

	/** Current tokens, refreshed if near expiry; null when not usable. */
	async function liveTokens(): Promise<SoundCloudTokenSet | null> {
		const current = await tokenStore.read();
		if (!current.tokens || !current.identity) {
			return null;
		}
		if (Date.parse(current.tokens.expiresAt) - REFRESH_SKEW_MS > now().getTime()) {
			return current.tokens;
		}
		refreshing ??= refreshTokens(current.tokens).finally(() => {
			refreshing = null;
		});
		return refreshing;
	}

	async function refreshTokens(tokens: SoundCloudTokenSet): Promise<SoundCloudTokenSet | null> {
		try {
			const response = await oauthHttp.refreshAccessToken(tokens.refreshToken);
			const next = tokenSetFromResponse(response, now(), tokens.refreshToken);
			// Re-read so a pending login started meanwhile is not dropped.
			const latest = await tokenStore.read();
			await tokenStore.write({ ...latest, tokens: next });
			return next;
		} catch (error) {
			console.error('[soundcloud-auth-api] Token refresh failed; reconnect required', error);
			return null;
		}
	}

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
			const tokens = await liveTokens();
			const { identity } = await tokenStore.read();
			if (!tokens || !identity) {
				return { connected: false };
			}
			return { connected: true, identity };
		},

		async getAccessToken() {
			const tokens = await liveTokens();
			return tokens?.accessToken ?? null;
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
