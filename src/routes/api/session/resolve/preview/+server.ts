/**
 * GET /api/session/resolve/preview?trackId= — CDN listen URL + kind
 * (`progressive` | `hls`) for Match Resolution `<audio>` / hls.js.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const GET: RequestHandler = async ({ url }) => {
	const trackId = url.searchParams.get('trackId') ?? '';

	try {
		const result = await getRuntimeImportSessionApi().resolvePreview({ trackId });
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'resolvePreview failed';
		console.error('[api/session/resolve/preview]', error);
		return json({ error: message }, { status: 400 });
	}
};
