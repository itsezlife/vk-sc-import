/**
 * POST /api/session/resolve/bind — attach a search hit → Accepted Match Record.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';
import { parseSoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

export const POST: RequestHandler = async ({ request }) => {
	let body: { matchIndex?: unknown; soundCloudTrack?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'Request body must be JSON' }, { status: 400 });
	}

	const soundCloudTrack = parseSoundCloudTrack(body.soundCloudTrack);
	if (!Number.isInteger(body.matchIndex) || !soundCloudTrack) {
		return json(
			{
				error:
					'matchIndex (integer) and soundCloudTrack { id, title, artist } are required'
			},
			{ status: 400 }
		);
	}

	try {
		const result = await getRuntimeImportSessionApi().bindSearchResult({
			matchIndex: body.matchIndex as number,
			soundCloudTrack
		});
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'bindSearchResult failed';
		console.error('[api/session/resolve/bind]', error);
		return json({ error: message }, { status: 400 });
	}
};
