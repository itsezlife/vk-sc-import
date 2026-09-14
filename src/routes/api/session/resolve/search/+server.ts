/**
 * GET /api/session/resolve/search?q= — in-app SoundCloud catalog search.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';

	try {
		const result = await getRuntimeImportSessionApi().searchCatalog({ query });
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'searchCatalog failed';
		console.error('[api/session/resolve/search]', error);
		return json({ error: message }, { status: 400 });
	}
};
