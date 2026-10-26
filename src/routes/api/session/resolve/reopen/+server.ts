/**
 * POST /api/session/resolve/reopen — undo the latest pick / bind / skip from the
 * Session File history; that row returns to the Match Resolution queue.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const POST: RequestHandler = async () => {
	try {
		const result = await getRuntimeImportSessionApi().reopenMatch();
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'reopenMatch failed';
		console.error('[api/session/resolve/reopen]', error);
		return json({ error: message }, { status: 400 });
	}
};
