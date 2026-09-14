/**
 * Local SoundCloud OAuth credential file (tokens + pending PKCE + identity).
 *
 * Separate from the Import Session File: auth is not catalog state. Lives under
 * a configured data dir (runtime: `.data/soundcloud-auth.json`). Writes use
 * temp + rename so a crash mid-write does not leave half-JSON credentials that
 * look like “logged in” with corrupt tokens.
 *
 * Invariant: logout / clear removes the file entirely. A failed login must not
 * wipe an existing successful token file (callers update pending then tokens
 * carefully — see SoundCloudAuthApi).
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SoundCloudIdentity } from './soundcloud-identity';

export const SOUNDCLOUD_AUTH_FILE_VERSION = 1 as const;

/** In-flight Authorization Code + PKCE attempt (CSRF `state` + verifier). */
export type PendingSoundCloudAuth = {
	state: string;
	codeVerifier: string;
	createdAt: string;
};

/** Durable tokens after a successful code exchange. Never sent to the browser. */
export type SoundCloudTokenSet = {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
	scope?: string;
};

export type SoundCloudAuthFile = {
	version: typeof SOUNDCLOUD_AUTH_FILE_VERSION;
	pending: PendingSoundCloudAuth | null;
	tokens: SoundCloudTokenSet | null;
	identity: SoundCloudIdentity | null;
};

export type SoundCloudAuthTokenStore = {
	read(): Promise<SoundCloudAuthFile>;
	write(file: SoundCloudAuthFile): Promise<void>;
	clear(): Promise<void>;
};

const EMPTY_AUTH_FILE: SoundCloudAuthFile = {
	version: SOUNDCLOUD_AUTH_FILE_VERSION,
	pending: null,
	tokens: null,
	identity: null
};

export function createSoundCloudAuthTokenStore(dataDir: string): SoundCloudAuthTokenStore {
	const filePath = join(dataDir, 'soundcloud-auth.json');

	return {
		async read() {
			let raw: string;
			try {
				raw = await readFile(filePath, 'utf8');
			} catch (error) {
				if (isNotFound(error)) {
					return { ...EMPTY_AUTH_FILE };
				}
				throw error;
			}

			const parsed = parseAuthFile(raw);
			if (parsed === null) {
				console.error(
					`[soundcloud-auth-token-store] Auth file at ${filePath} is unreadable or invalid; treating as empty`
				);
				return { ...EMPTY_AUTH_FILE };
			}
			return parsed;
		},

		async write(file) {
			await mkdir(dirname(filePath), { recursive: true });
			const tempPath = `${filePath}.${process.pid}.tmp`;
			await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
			await rename(tempPath, filePath);
		},

		async clear() {
			try {
				await unlink(filePath);
			} catch (error) {
				if (!isNotFound(error)) {
					throw error;
				}
			}
		}
	};
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 'ENOENT'
	);
}

function parseAuthFile(raw: string): SoundCloudAuthFile | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (parsed === null || typeof parsed !== 'object') {
		return null;
	}

	const record = parsed as Record<string, unknown>;
	if (record.version !== SOUNDCLOUD_AUTH_FILE_VERSION) {
		return null;
	}

	const pending = parsePending(record.pending);
	if (record.pending !== null && record.pending !== undefined && pending === undefined) {
		return null;
	}

	const tokens = parseTokens(record.tokens);
	if (record.tokens !== null && record.tokens !== undefined && tokens === undefined) {
		return null;
	}

	const identity = parseIdentity(record.identity);
	if (record.identity !== null && record.identity !== undefined && identity === undefined) {
		return null;
	}

	return {
		version: SOUNDCLOUD_AUTH_FILE_VERSION,
		pending: pending ?? null,
		tokens: tokens ?? null,
		identity: identity ?? null
	};
}

function parsePending(value: unknown): PendingSoundCloudAuth | null | undefined {
	if (value === null) {
		return null;
	}
	if (value === undefined) {
		return null;
	}
	if (typeof value !== 'object') {
		return undefined;
	}
	const row = value as Record<string, unknown>;
	if (
		typeof row.state !== 'string' ||
		typeof row.codeVerifier !== 'string' ||
		typeof row.createdAt !== 'string'
	) {
		return undefined;
	}
	return {
		state: row.state,
		codeVerifier: row.codeVerifier,
		createdAt: row.createdAt
	};
}

function parseTokens(value: unknown): SoundCloudTokenSet | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== 'object') {
		return undefined;
	}
	const row = value as Record<string, unknown>;
	if (
		typeof row.accessToken !== 'string' ||
		typeof row.refreshToken !== 'string' ||
		typeof row.expiresAt !== 'string'
	) {
		return undefined;
	}
	const scope = row.scope;
	if (scope !== undefined && typeof scope !== 'string') {
		return undefined;
	}
	return {
		accessToken: row.accessToken,
		refreshToken: row.refreshToken,
		expiresAt: row.expiresAt,
		...(typeof scope === 'string' ? { scope } : {})
	};
}

function parseIdentity(value: unknown): SoundCloudIdentity | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== 'object') {
		return undefined;
	}
	const row = value as Record<string, unknown>;
	if (typeof row.id !== 'string' || typeof row.username !== 'string') {
		return undefined;
	}
	const permalinkUrl = row.permalinkUrl;
	if (permalinkUrl !== undefined && typeof permalinkUrl !== 'string') {
		return undefined;
	}
	return {
		id: row.id,
		username: row.username,
		...(typeof permalinkUrl === 'string' ? { permalinkUrl } : {})
	};
}
