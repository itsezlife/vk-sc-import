import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

/** GET /api/session — current Import Session library summary, or null. */
export const GET: RequestHandler = async () => {
	const result = await getRuntimeImportSessionApi().getSession();
	return json(result);
};
