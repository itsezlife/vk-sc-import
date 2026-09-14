/**
 * Injectable SoundCloud OAuth /me HTTP boundary.
 *
 * Real implementation uses `fetch`. Seam tests inject a fake so CI never hits
 * SoundCloud. Keeps transport (form bodies, Authorization header) out of the
 * auth API orchestration.
 */

import type { SoundCloudOAuthConfig } from './oauth-config';
import type { SoundCloudIdentity } from './soundcloud-identity';
import type { SoundCloudTokenSet } from './auth-token-store';

export type ExchangeAuthorizationCodeInput = {
	code: string;
	codeVerifier: string;
};

export type SoundCloudMeDto = {
	id: number | string;
	username: string;
	permalink_url?: string;
};

export type SoundCloudTokenResponse = {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope?: string;
};

export type SoundCloudOAuthHttp = {
	exchangeAuthorizationCode(
		input: ExchangeAuthorizationCodeInput
	): Promise<SoundCloudTokenResponse>;
	fetchMe(accessToken: string): Promise<SoundCloudMeDto>;
	signOut(accessToken: string): Promise<void>;
};

export function createSoundCloudOAuthHttp(config: SoundCloudOAuthConfig): SoundCloudOAuthHttp {
	return {
		async exchangeAuthorizationCode(input) {
			const body = new URLSearchParams();
			body.set('grant_type', 'authorization_code');
			body.set('client_id', config.clientId);
			body.set('redirect_uri', config.redirectUri);
			body.set('code_verifier', input.codeVerifier);
			body.set('code', input.code);
			if (config.clientSecret) {
				body.set('client_secret', config.clientSecret);
			}

			const response = await fetch(config.tokenUrl, {
				method: 'POST',
				headers: {
					accept: 'application/json; charset=utf-8',
					'content-type': 'application/x-www-form-urlencoded'
				},
				body
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`SoundCloud token exchange failed (HTTP ${response.status})${text ? `: ${text}` : ''}`
				);
			}

			return (await response.json()) as SoundCloudTokenResponse;
		},

		async fetchMe(accessToken) {
			const response = await fetch(`${config.apiBaseUrl}/me`, {
				headers: {
					accept: 'application/json; charset=utf-8',
					authorization: `OAuth ${accessToken}`
				}
			});

			if (!response.ok) {
				throw new Error(`SoundCloud /me failed (HTTP ${response.status})`);
			}

			return (await response.json()) as SoundCloudMeDto;
		},

		async signOut(accessToken) {
			const response = await fetch(config.signOutUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ access_token: accessToken })
			});

			// Already-invalid sessions return 401 — treat as signed out locally.
			if (!response.ok && response.status !== 401) {
				throw new Error(`SoundCloud sign-out failed (HTTP ${response.status})`);
			}
		}
	};
}

/** Maps token response + clock into the durable token set shape. */
export function tokenSetFromResponse(
	response: SoundCloudTokenResponse,
	now = new Date()
): SoundCloudTokenSet {
	const expiresAt = new Date(now.getTime() + response.expires_in * 1000).toISOString();
	return {
		accessToken: response.access_token,
		refreshToken: response.refresh_token,
		expiresAt,
		...(response.scope !== undefined ? { scope: response.scope } : {})
	};
}

/** Maps `/me` JSON into domain identity (no DTO leakage past this boundary). */
export function identityFromMeDto(dto: SoundCloudMeDto): SoundCloudIdentity {
	return {
		id: String(dto.id),
		username: dto.username,
		...(dto.permalink_url ? { permalinkUrl: dto.permalink_url } : {})
	};
}
