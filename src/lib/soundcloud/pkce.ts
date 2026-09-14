/**
 * PKCE (RFC 7636) pair for SoundCloud OAuth 2.1 authorization-code exchange.
 *
 * SoundCloud requires S256. The verifier stays on this machine (auth token store
 * pending record); only the challenge goes to the authorize URL. Without PKCE a
 * stolen redirect `code` could be exchanged by anyone who intercepted it.
 */

import { createHash, randomBytes } from 'node:crypto';

export type PkcePair = {
	codeVerifier: string;
	codeChallenge: string;
	codeChallengeMethod: 'S256';
};

/** Builds a fresh verifier + S256 challenge for one login attempt. */
export function createPkcePair(): PkcePair {
	const codeVerifier = toBase64Url(randomBytes(32));
	const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
	return {
		codeVerifier,
		codeChallenge,
		codeChallengeMethod: 'S256'
	};
}

/** URL-safe base64 without padding — used for PKCE verifier and OAuth `state`. */
export function toBase64Url(buf: Buffer): string {
	return buf.toString('base64url');
}
