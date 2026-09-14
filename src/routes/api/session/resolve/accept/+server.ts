/**
 * POST /api/session/resolve/accept — pick one Ambiguous candidate → Accepted.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const POST: RequestHandler = async ({ request }) => {
	let body: { matchIndex?: unknown; soundCloudTrackId?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'Request body must be JSON' }, { status: 400 });
	}

	if (!Number.isInteger(body.matchIndex) || typeof body.soundCloudTrackId !== 'string') {
		return json(
			{ error: 'matchIndex (integer) and soundCloudTrackId (string) are required' },
			{ status: 400 }
		);
	}

	try {
		const result = await getRuntimeImportSessionApi().acceptCandidate({
			matchIndex: body.matchIndex as number,
			soundCloudTrackId: body.soundCloudTrackId
		});
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'acceptCandidate failed';
		console.error('[api/session/resolve/accept]', error);
		return json({ error: message }, { status: 400 });
	}
};
