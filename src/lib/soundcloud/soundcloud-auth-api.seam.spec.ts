import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSoundCloudAuthTokenStore } from './auth-token-store';
import type { SoundCloudOAuthConfig } from './oauth-config';
import type { SoundCloudOAuthHttp } from './oauth-http';
import { createSoundCloudAuthApi } from './soundcloud-auth-api';

/**
 * Seam: SoundCloud auth API (PKCE start/complete/status/logout + token file).
 * No live SoundCloud — oauthHttp is a fake.
 */
describe('SoundCloud auth API seam', () => {
	let dataDir: string;
	let config: SoundCloudOAuthConfig;
	let oauthHttp: SoundCloudOAuthHttp;
	let exchangeSpy: SoundCloudOAuthHttp['exchangeAuthorizationCode'];
	let fetchMeSpy: SoundCloudOAuthHttp['fetchMe'];
	let signOutSpy: SoundCloudOAuthHttp['signOut'];
	let exchangeMock: ReturnType<typeof vi.fn>;
	let fetchMeMock: ReturnType<typeof vi.fn>;
	let signOutMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-auth-api-'));
		config = {
			clientId: 'test-client-id',
			redirectUri: 'http://localhost:5173/auth/soundcloud/callback',
			authorizeUrl: 'https://secure.soundcloud.com/authorize',
			tokenUrl: 'https://secure.soundcloud.com/oauth/token',
			apiBaseUrl: 'https://api.soundcloud.com',
			signOutUrl: 'https://secure.soundcloud.com/sign-out'
		};

		exchangeMock = vi.fn(async () => ({
			access_token: 'access-token',
			refresh_token: 'refresh-token',
			expires_in: 3600,
			scope: '*'
		}));
		fetchMeMock = vi.fn(async () => ({
			id: 99,
			username: 'demo-user',
			permalink_url: 'https://soundcloud.com/demo-user'
		}));
		signOutMock = vi.fn(async () => undefined);

		exchangeSpy = exchangeMock as SoundCloudOAuthHttp['exchangeAuthorizationCode'];
		fetchMeSpy = fetchMeMock as SoundCloudOAuthHttp['fetchMe'];
		signOutSpy = signOutMock as SoundCloudOAuthHttp['signOut'];

		oauthHttp = {
			exchangeAuthorizationCode: exchangeSpy,
			fetchMe: fetchMeSpy,
			signOut: signOutSpy
		};
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	function createApi(now = () => new Date('2026-06-01T12:00:00.000Z')) {
		return createSoundCloudAuthApi({
			config,
			tokenStore: createSoundCloudAuthTokenStore(dataDir),
			oauthHttp,
			now
		});
	}

	it('startLogin stores pending PKCE and returns an authorize URL with challenge and state', async () => {
		const api = createApi();
		const { authorizeUrl } = await api.startLogin();
		const url = new URL(authorizeUrl);

		expect(url.origin + url.pathname).toBe('https://secure.soundcloud.com/authorize');
		expect(url.searchParams.get('client_id')).toBe('test-client-id');
		expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('code_challenge')).toBeTruthy();
		expect(url.searchParams.get('state')).toBeTruthy();

		const store = createSoundCloudAuthTokenStore(dataDir);
		const file = await store.read();
		expect(file.pending?.state).toBe(url.searchParams.get('state'));
		expect(file.pending?.codeVerifier).toBeTruthy();
		expect(file.tokens).toBeNull();
	});

	it('completeLogin exchanges the code, persists identity, and reports connected status', async () => {
		const api = createApi();
		const { authorizeUrl } = await api.startLogin();
		const state = new URL(authorizeUrl).searchParams.get('state');
		expect(state).toBeTruthy();

		const status = await api.completeLogin({ code: 'auth-code', state: state! });

		expect(status).toEqual({
			connected: true,
			identity: {
				id: '99',
				username: 'demo-user',
				permalinkUrl: 'https://soundcloud.com/demo-user'
			}
		});

		const after = await createSoundCloudAuthTokenStore(dataDir).read();
		expect(after.pending).toBeNull();
		expect(after.tokens?.accessToken).toBe('access-token');
		expect(after.tokens?.refreshToken).toBe('refresh-token');
		expect(after.tokens?.expiresAt).toBe('2026-06-01T13:00:00.000Z');
		expect(after.identity?.username).toBe('demo-user');

		expect(exchangeMock).toHaveBeenCalledOnce();
		const exchangeArg = exchangeMock.mock.calls[0]?.[0] as {
			code: string;
			codeVerifier: string;
		};
		expect(exchangeArg.code).toBe('auth-code');
		expect(exchangeArg.codeVerifier.length).toBeGreaterThan(10);
		expect(fetchMeMock).toHaveBeenCalledWith('access-token');

		const reloaded = await api.getStatus();
		expect(reloaded).toEqual(status);
	});

	it('completeLogin rejects a mismatched state without wiping existing credentials', async () => {
		const api = createApi();
		const first = await api.startLogin();
		const goodState = new URL(first.authorizeUrl).searchParams.get('state')!;
		await api.completeLogin({ code: 'auth-code', state: goodState });

		await api.startLogin();
		await expect(
			api.completeLogin({ code: 'other', state: 'wrong-state' })
		).rejects.toThrow(/state mismatch/i);

		const status = await api.getStatus();
		expect(status).toEqual({
			connected: true,
			identity: {
				id: '99',
				username: 'demo-user',
				permalinkUrl: 'https://soundcloud.com/demo-user'
			}
		});
	});

	it('getStatus returns disconnected when no tokens exist', async () => {
		const api = createApi();
		await expect(api.getStatus()).resolves.toEqual({ connected: false });
	});

	it('getStatus returns disconnected when access token is expired', async () => {
		const api = createApi(() => new Date('2026-06-01T12:00:00.000Z'));
		const { authorizeUrl } = await api.startLogin();
		const state = new URL(authorizeUrl).searchParams.get('state')!;
		await api.completeLogin({ code: 'auth-code', state });

		const later = createSoundCloudAuthApi({
			config,
			tokenStore: createSoundCloudAuthTokenStore(dataDir),
			oauthHttp,
			now: () => new Date('2026-06-01T14:00:00.000Z')
		});
		await expect(later.getStatus()).resolves.toEqual({ connected: false });
	});

	it('logout clears local tokens and calls remote sign-out', async () => {
		const api = createApi();
		const { authorizeUrl } = await api.startLogin();
		const state = new URL(authorizeUrl).searchParams.get('state')!;
		await api.completeLogin({ code: 'auth-code', state });

		await api.logout();

		expect(signOutMock).toHaveBeenCalledWith('access-token');
		await expect(api.getStatus()).resolves.toEqual({ connected: false });
		const file = await createSoundCloudAuthTokenStore(dataDir).read();
		expect(file.tokens).toBeNull();
		expect(file.identity).toBeNull();
	});

	it('logout still clears local credentials when remote sign-out fails', async () => {
		signOutMock.mockRejectedValueOnce(new Error('network down'));
		const api = createApi();
		const { authorizeUrl } = await api.startLogin();
		const state = new URL(authorizeUrl).searchParams.get('state')!;
		await api.completeLogin({ code: 'auth-code', state });

		await api.logout();
		await expect(api.getStatus()).resolves.toEqual({ connected: false });
	});
});
