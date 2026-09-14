import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeSoundCloudAuthApi } from '$lib/soundcloud/runtime.server';

/**
 * GET /api/soundcloud/auth/start — begin OAuth Authorization Code + PKCE.
 * Returns `{ authorizeUrl }` for the browser to navigate; does not 302 so the
 * UI can show errors if client id is missing.
 */
export const GET: RequestHandler = async () => {
	try {
		const result = await getRuntimeSoundCloudAuthApi().startLogin();
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'SoundCloud auth start failed';
		console.error('[api/soundcloud/auth/start]', error);
		return json({ error: message }, { status: 500 });
	}
};
