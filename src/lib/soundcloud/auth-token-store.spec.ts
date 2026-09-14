import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	SOUNDCLOUD_AUTH_FILE_VERSION,
	createSoundCloudAuthTokenStore
} from './auth-token-store';

describe('SoundCloud auth token store', () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'vk-sc-auth-'));
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it('returns an empty auth file when nothing is on disk', async () => {
		const store = createSoundCloudAuthTokenStore(dataDir);
		await expect(store.read()).resolves.toEqual({
			version: SOUNDCLOUD_AUTH_FILE_VERSION,
			pending: null,
			tokens: null,
			identity: null
		});
	});

	it('round-trips pending, tokens, and identity', async () => {
		const store = createSoundCloudAuthTokenStore(dataDir);
		const file = {
			version: SOUNDCLOUD_AUTH_FILE_VERSION,
			pending: {
				state: 'state-1',
				codeVerifier: 'verifier-1',
				createdAt: '2026-01-01T00:00:00.000Z'
			},
			tokens: {
				accessToken: 'access',
				refreshToken: 'refresh',
				expiresAt: '2026-01-01T01:00:00.000Z',
				scope: '*'
			},
			identity: {
				id: '42',
				username: 'demo',
				permalinkUrl: 'https://soundcloud.com/demo'
			}
		};

		await store.write(file);
		await expect(store.read()).resolves.toEqual(file);
	});

	it('clear removes the file so a later read is empty', async () => {
		const store = createSoundCloudAuthTokenStore(dataDir);
		await store.write({
			version: SOUNDCLOUD_AUTH_FILE_VERSION,
			pending: null,
			tokens: {
				accessToken: 'access',
				refreshToken: 'refresh',
				expiresAt: '2026-01-01T01:00:00.000Z'
			},
			identity: { id: '1', username: 'x' }
		});

		await store.clear();
		await expect(store.read()).resolves.toEqual({
			version: SOUNDCLOUD_AUTH_FILE_VERSION,
			pending: null,
			tokens: null,
			identity: null
		});
	});
});
