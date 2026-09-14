/**
 * GET /api/session/export — download Unresolved or full Match Records JSON.
 *
 * Query `scope=unresolved` (default) or `scope=all`. Does not mutate the
 * Session File. Returns an attachment so the browser saves a file.
 */

import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const GET: RequestHandler = async ({ url }) => {
	const scope = url.searchParams.get('scope') ?? 'unresolved';
	const api = getRuntimeImportSessionApi();

	try {
		const exported =
			scope === 'all'
				? await api.exportMatchRecords()
				: await api.exportUnresolved();

		return new Response(exported.body, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="${exported.filename}"`,
				'cache-control': 'no-store'
			}
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Match Record export failed';
		console.error('[api/session/export] export failed', error);
		return new Response(JSON.stringify({ message }), {
			status: 400,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store'
			}
		});
	}
};
