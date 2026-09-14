import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeSoundCloudAuthApi } from '$lib/soundcloud/runtime.server';

/** POST /api/soundcloud/logout — clear local SoundCloud tokens (and remote sign-out). */
export const POST: RequestHandler = async () => {
	await getRuntimeSoundCloudAuthApi().logout();
	return json({ ok: true });
};
