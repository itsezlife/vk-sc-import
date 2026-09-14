import { redirect, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeSoundCloudAuthApi } from '$lib/soundcloud/runtime.server';

/**
 * GET /auth/soundcloud/callback — SoundCloud redirects here with `code` + `state`.
 * Completes PKCE exchange on the server, then sends the browser home. Tokens
 * never appear in the redirect URL — only an optional `sc_error` query flag.
 */
export const GET: RequestHandler = async ({ url }) => {
	const error = url.searchParams.get('error');
	if (error) {
		console.error('[auth/soundcloud/callback] authorize error', error);
		redirect(303, '/?sc_error=authorize_denied');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) {
		redirect(303, '/?sc_error=missing_code');
	}

	try {
		await getRuntimeSoundCloudAuthApi().completeLogin({ code, state });
	} catch (err) {
		if (isRedirect(err)) {
			throw err;
		}
		console.error('[auth/soundcloud/callback] completeLogin failed', err);
		redirect(303, '/?sc_error=complete_failed');
	}

	redirect(303, '/');
};
