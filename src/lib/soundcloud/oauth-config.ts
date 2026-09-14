/**
 * SoundCloud OAuth client configuration for a local public (or confidential) app.
 *
 * Spec wants a public client id in env — no secret committed to the repo.
 * SoundCloud may still treat some apps as confidential until marked public;
 * `clientSecret` is therefore optional: omit for pure PKCE public clients,
 * set via env when token exchange still requires a secret.
 */

export type SoundCloudOAuthConfig = {
	clientId: string;
	/** Present only for confidential / not-yet-public SoundCloud apps. */
	clientSecret?: string;
	redirectUri: string;
	authorizeUrl: string;
	tokenUrl: string;
	apiBaseUrl: string;
	signOutUrl: string;
};

export const DEFAULT_SOUNDCLOUD_REDIRECT_URI =
	'http://localhost:5173/auth/soundcloud/callback';

const AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const API_BASE_URL = 'https://api.soundcloud.com';
const SIGN_OUT_URL = 'https://secure.soundcloud.com/sign-out';

export type SoundCloudOAuthEnv = {
	SOUNDCLOUD_CLIENT_ID?: string;
	SOUNDCLOUD_CLIENT_SECRET?: string;
	SOUNDCLOUD_REDIRECT_URI?: string;
};

/**
 * Builds config from env-like values. Throws when client id is missing — the
 * app cannot start an OAuth dance without it.
 */
export function loadSoundCloudOAuthConfig(
	env: SoundCloudOAuthEnv = process.env
): SoundCloudOAuthConfig {
	const clientId = env.SOUNDCLOUD_CLIENT_ID?.trim();
	if (!clientId) {
		throw new Error(
			'SoundCloud OAuth requires SOUNDCLOUD_CLIENT_ID (see .env.example and README)'
		);
	}

	const secret = env.SOUNDCLOUD_CLIENT_SECRET?.trim();
	const redirectUri =
		env.SOUNDCLOUD_REDIRECT_URI?.trim() || DEFAULT_SOUNDCLOUD_REDIRECT_URI;

	return {
		clientId,
		...(secret ? { clientSecret: secret } : {}),
		redirectUri,
		authorizeUrl: AUTHORIZE_URL,
		tokenUrl: TOKEN_URL,
		apiBaseUrl: API_BASE_URL,
		signOutUrl: SIGN_OUT_URL
	};
}
