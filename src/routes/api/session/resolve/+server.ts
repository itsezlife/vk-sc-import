/**
 * GET /api/session/resolve — Ambiguous then Unresolved Match Resolution queue.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const GET: RequestHandler = async () => {
	const result = await getRuntimeImportSessionApi().getResolutionQueue();
	return json(result);
};
