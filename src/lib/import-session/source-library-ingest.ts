/**
 * Parse a Source Library payload into valid Library Tracks + row errors.
 *
 * JSON preferred, CSV accepted. Invalid rows are reported and skipped — they
 * must not enter the track list that becomes an Import Session. Format detection
 * is caller-owned (`format`) so paste/upload UIs stay explicit.
 */

import type { LibraryRowValidationError, LibraryTrack } from './library-track';
import { ValidationCode } from './validation-code';

export type SourceLibraryFormat = 'json' | 'csv';

export type SourceLibraryIngestResult = {
	tracks: LibraryTrack[];
	validationErrors: LibraryRowValidationError[];
};

/**
 * Ingest raw Source Library text into validated tracks and row-level errors.
 *
 * Empty artist or title after trim counts as missing. Whitespace-only rows in
 * CSV are skipped without an error (they are not attempted Library Tracks).
 * `message` on errors is a stable ValidationCode for client i18n.
 */
export function ingestSourceLibrary(
	format: SourceLibraryFormat,
	content: string
): SourceLibraryIngestResult {
	if (format === 'json') {
		return ingestJsonLibrary(content);
	}
	return ingestCsvLibrary(content);
}

function ingestJsonLibrary(content: string): SourceLibraryIngestResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			tracks: [],
			validationErrors: [
				{
					row: 0,
					message: ValidationCode.sourceLibraryJsonInvalid
				}
			]
		};
	}

	const rows = normalizeJsonRows(parsed);
	if (rows === null) {
		return {
			tracks: [],
			validationErrors: [
				{
					row: 0,
					message: ValidationCode.sourceLibraryJsonShape
				}
			]
		};
	}

	const tracks: LibraryTrack[] = [];
	const validationErrors: LibraryRowValidationError[] = [];

	rows.forEach((row, index) => {
		const result = validateRow(row, index + 1);
		if (result.ok) {
			tracks.push(result.track);
		} else {
			validationErrors.push(result.error);
		}
	});

	return { tracks, validationErrors };
}

function normalizeJsonRows(parsed: unknown): unknown[] | null {
	if (Array.isArray(parsed)) {
		return parsed;
	}
	if (
		parsed !== null &&
		typeof parsed === 'object' &&
		'tracks' in parsed &&
		Array.isArray((parsed as { tracks: unknown }).tracks)
	) {
		return (parsed as { tracks: unknown[] }).tracks;
	}
	return null;
}

function ingestCsvLibrary(content: string): SourceLibraryIngestResult {
	const lines = content.split(/\r?\n/);
	if (lines.length === 0 || (lines.length === 1 && lines[0]?.trim() === '')) {
		return {
			tracks: [],
			validationErrors: [{ row: 0, message: ValidationCode.sourceLibraryCsvEmpty }]
		};
	}

	const headerCells = parseCsvLine(lines[0] ?? '');
	const artistIdx = headerCells.findIndex((cell) => cell.trim().toLowerCase() === 'artist');
	const titleIdx = headerCells.findIndex((cell) => cell.trim().toLowerCase() === 'title');

	if (artistIdx < 0 || titleIdx < 0) {
		return {
			tracks: [],
			validationErrors: [
				{
					row: 1,
					message: ValidationCode.sourceLibraryCsvHeaders
				}
			]
		};
	}

	const tracks: LibraryTrack[] = [];
	const validationErrors: LibraryRowValidationError[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '') {
			continue;
		}

		const cells = parseCsvLine(line);
		const artist = cells[artistIdx] ?? '';
		const title = cells[titleIdx] ?? '';
		const result = validateRow({ artist, title }, i + 1);
		if (result.ok) {
			tracks.push(result.track);
		} else {
			validationErrors.push(result.error);
		}
	}

	return { tracks, validationErrors };
}

type RowValidation =
	| { ok: true; track: LibraryTrack }
	| { ok: false; error: LibraryRowValidationError };

function validateRow(row: unknown, rowNumber: number): RowValidation {
	const artistRaw =
		row !== null && typeof row === 'object' && 'artist' in row
			? String((row as { artist: unknown }).artist ?? '')
			: '';
	const titleRaw =
		row !== null && typeof row === 'object' && 'title' in row
			? String((row as { title: unknown }).title ?? '')
			: '';

	const artist = artistRaw.trim();
	const title = titleRaw.trim();

	if (!artist || !title) {
		return {
			ok: false,
			error: {
				row: rowNumber,
				message: ValidationCode.libraryTrackRequiresArtistTitle,
				artist,
				title
			}
		};
	}

	return { ok: true, track: { artist, title } };
}

/**
 * Minimal RFC4180-ish line split: commas outside quotes; "" → " inside quotes.
 * Enough for Source Library templates — not a general CSV suite.
 */
function parseCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
			continue;
		}

		if (ch === '"') {
			inQuotes = true;
			continue;
		}
		if (ch === ',') {
			cells.push(current);
			current = '';
			continue;
		}
		current += ch;
	}

	cells.push(current);
	return cells;
}
