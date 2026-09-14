import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeImportSessionApi } from '$lib/import-session/runtime.server';
import type { SourceLibraryFormat } from '$lib/import-session/source-library-ingest';
import { ValidationCode } from '$lib/import-session/validation-code';

type LibraryBody = {
	format?: unknown;
	content?: unknown;
};

/** POST /api/session/library — ingest Source Library into an Import Session. */
export const POST: RequestHandler = async ({ request }) => {
	let body: LibraryBody;
	try {
		body = (await request.json()) as LibraryBody;
	} catch {
		return json(
			{
				session: null,
				validationErrors: [{ row: 0, message: ValidationCode.requestBodyMustBeJson }]
			},
			{ status: 400 }
		);
	}

	const format = body.format;
	const content = body.content;

	if (format !== 'json' && format !== 'csv') {
		return json(
			{
				session: null,
				validationErrors: [{ row: 0, message: ValidationCode.formatMustBeJsonOrCsv }]
			},
			{ status: 400 }
		);
	}

	if (typeof content !== 'string') {
		return json(
			{
				session: null,
				validationErrors: [{ row: 0, message: ValidationCode.contentMustBeString }]
			},
			{ status: 400 }
		);
	}

	const result = await getRuntimeImportSessionApi().ingestLibrary({
		format: format as SourceLibraryFormat,
		content
	});

	return json(result);
};
