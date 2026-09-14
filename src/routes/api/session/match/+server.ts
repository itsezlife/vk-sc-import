/**
 * POST /api/session/match — run Catalog Match over the loaded Import Session.
 *
 * Streams NDJSON so the UI can show progress during a long pass without a
 * second polling channel. Lines: `progress` → `done` | `aborted` (or a single
 * `error`). Client disconnect / fetch abort cancels the paced run; Session File
 * keeps the last persisted Match Record prefix.
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
				const result = await getRuntimeImportSessionApi().runCatalogMatch({
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
						error instanceof Error ? error.message : 'Catalog Match failed';
					console.error('[api/session/match] Catalog Match failed', error);
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
