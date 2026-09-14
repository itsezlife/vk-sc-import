import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeSoundCloudAuthApi } from '$lib/soundcloud/runtime.server';

/** GET /api/soundcloud/status — connected identity for the landing page (no tokens). */
export const GET: RequestHandler = async () => {
	const status = await getRuntimeSoundCloudAuthApi().getStatus();
	return json(status);
};
