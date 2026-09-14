/**
 * POST /api/session/playlist — write Import Playlist for the loaded session.
 *
 * Streams NDJSON so the UI can show progress during a long add batch without a
 * second polling channel. Lines: `progress` → `done` (or a single `error`).
 */

import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';

export const POST: RequestHandler = async () => {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: unknown) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
			};

			try {
				const result = await getRuntimeImportSessionApi().writeImportPlaylist({
					onProgress: (progress) => {
						send({ type: 'progress', ...progress });
					}
				});
				send({ type: 'done', ...result });
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Import Playlist write failed';
				console.error('[api/session/playlist] Import Playlist write failed', error);
				send({ type: 'error', message });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
};
