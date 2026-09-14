/**
 * GET /api/session/review — bound Match Records for post-write review.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const GET: RequestHandler = async () => {
	try {
		const result = await getRuntimeImportSessionApi().getReviewList();
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'getReviewList failed';
		console.error('[api/session/review]', error);
		return json({ error: message }, { status: 400 });
	}
};
