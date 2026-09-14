import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPkcePair } from './pkce';

describe('createPkcePair', () => {
	it('returns an S256 challenge derived from the verifier', () => {
		const pair = createPkcePair();

		expect(pair.codeChallengeMethod).toBe('S256');
		expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43);
		expect(pair.codeVerifier.length).toBeLessThanOrEqual(128);
		expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);

		const expected = createHash('sha256')
			.update(pair.codeVerifier)
			.digest('base64url');
		expect(pair.codeChallenge).toBe(expected);
	});

	it('generates a unique pair on each call', () => {
		const a = createPkcePair();
		const b = createPkcePair();
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
		expect(a.codeChallenge).not.toBe(b.codeChallenge);
	});
});
