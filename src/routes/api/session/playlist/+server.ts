/**
 * POST /api/session/playlist — write Import Playlist for the loaded session.
 *
 * Streams NDJSON so the UI can show progress during a long add batch without a
 * second polling channel. Lines: `progress` → `done` | `aborted` (or a single
 * `error`). Client disconnect / fetch abort cancels the paced run; Session File
 * keeps playlist identity + completed membership steps (`in_progress`).
 */

import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';
import { isRunAbortedError } from '$lib/import-session/run-abort';

export const POST: RequestHandler = async ({ request }) => {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: unknown) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
			};

			try {
				const result = await getRuntimeImportSessionApi().writeImportPlaylist({
					signal: request.signal,
					onProgress: (progress) => {
						send({ type: 'progress', ...progress });
					}
				});
				send({ type: 'done', ...result });
			} catch (error) {
				if (isRunAbortedError(error) || request.signal.aborted) {
					send({ type: 'aborted' });
				} else {
					const message =
						error instanceof Error ? error.message : 'Import Playlist write failed';
					console.error('[api/session/playlist] Import Playlist write failed', error);
					send({ type: 'error', message });
				}
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
