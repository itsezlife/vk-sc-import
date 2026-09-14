/**
 * POST /api/session/resolve/skip — Ambiguous → Unresolved (or keep Unresolved).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

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
		const result = await getRuntimeImportSessionApi().skipMatch({
			matchIndex: body.matchIndex as number
		});
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'skipMatch failed';
		console.error('[api/session/resolve/skip]', error);
		return json({ error: message }, { status: 400 });
	}
};
