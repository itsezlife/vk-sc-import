/**
 * GET /api/session/resolve/decided — Accepted + skipped rows (Decided list).
 * POST — reopen one of them by `matchIndex`; it returns to the resolution queue.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const GET: RequestHandler = async () => {
	const result = await getRuntimeImportSessionApi().getDecidedList();
	return json(result);
};

export const POST: RequestHandler = async ({ request }) => {
	let body: { matchIndex?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'Request body must be JSON' }, { status: 400 });
	}

	if (!Number.isInteger(body.matchIndex)) {
		return json({ error: 'matchIndex (integer) is required' }, { status: 400 });
	}

	try {
		const result = await getRuntimeImportSessionApi().reopenDecided({
			matchIndex: body.matchIndex as number
		});
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'reopenDecided failed';
		console.error('[api/session/resolve/decided]', error);
		return json({ error: message }, { status: 400 });
	}
};
