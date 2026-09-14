/**
 * Match Record export payloads for Unresolved (and optional full) downloads.
 *
 * Pure serializer over Session File Match Records — no I/O. Hosts turn the
 * returned JSON text into a browser download or HTTP body. Unresolved export
 * is the default offline/share surface for catalog gaps; full export is the
 * audit document of every Match Record leaf.
 *
 * Owns: export document shape + JSON stringification.
 * Does not own: Session File I/O, HTTP routes, UI download chrome.
 */

import type { LibraryTrack } from './library-track';
import type { MatchRecord } from './match-record';
import type { SoundCloudTrack } from '$lib/soundcloud/soundcloud-track';

export const MATCH_EXPORT_VERSION = 1 as const;

export type UnresolvedExportRow = {
	libraryTrack: LibraryTrack;
	confidence: number;
	/** True when the user skipped this row during Match Resolution. */
	deferred: boolean;
};

export type UnresolvedExportDocument = {
	version: typeof MATCH_EXPORT_VERSION;
	kind: 'unresolved';
	exportedAt: string;
	tracks: UnresolvedExportRow[];
};

export type MatchRecordExportRow =
	| {
			classification: 'auto' | 'accepted';
			libraryTrack: LibraryTrack;
			confidence: number;
			soundCloudTrack: SoundCloudTrack;
			alreadyOnSc: boolean;
	  }
	| {
			classification: 'ambiguous';
			libraryTrack: LibraryTrack;
			confidence: number;
			candidates: SoundCloudTrack[];
	  }
	| {
			classification: 'unresolved';
			libraryTrack: LibraryTrack;
			confidence: number;
			deferred: boolean;
	  };

export type MatchRecordsExportDocument = {
	version: typeof MATCH_EXPORT_VERSION;
	kind: 'match-records';
	exportedAt: string;
	records: MatchRecordExportRow[];
};

/**
 * Builds an Unresolved-only export document from Match Records.
 * Rows keep Session File order. Empty when there are no Unresolved leaves.
 */
export function buildUnresolvedExport(
	matchRecords: MatchRecord[],
	exportedAt = new Date()
): UnresolvedExportDocument {
	const tracks: UnresolvedExportRow[] = [];
	for (const record of matchRecords) {
		if (record.classification !== 'unresolved') {
			continue;
		}
		tracks.push({
			libraryTrack: record.libraryTrack,
			confidence: record.confidence,
			deferred: record.deferred === true
		});
	}
	return {
		version: MATCH_EXPORT_VERSION,
		kind: 'unresolved',
		exportedAt: exportedAt.toISOString(),
		tracks
	};
}

/**
 * Builds a full Match Records export (all classifications) in Session File order.
 */
export function buildMatchRecordsExport(
	matchRecords: MatchRecord[],
	exportedAt = new Date()
): MatchRecordsExportDocument {
	const records: MatchRecordExportRow[] = matchRecords.map(toExportRow);
	return {
		version: MATCH_EXPORT_VERSION,
		kind: 'match-records',
		exportedAt: exportedAt.toISOString(),
		records
	};
}

/** Stable pretty-printed JSON for downloads (trailing newline). */
export function stringifyMatchExport(
	document: UnresolvedExportDocument | MatchRecordsExportDocument
): string {
	return `${JSON.stringify(document, null, 2)}\n`;
}

function toExportRow(record: MatchRecord): MatchRecordExportRow {
	if (record.classification === 'auto' || record.classification === 'accepted') {
		return {
			classification: record.classification,
			libraryTrack: record.libraryTrack,
			confidence: record.confidence,
			soundCloudTrack: record.soundCloudTrack,
			alreadyOnSc: record.alreadyOnSc === true
		};
	}
	if (record.classification === 'ambiguous') {
		return {
			classification: 'ambiguous',
			libraryTrack: record.libraryTrack,
			confidence: record.confidence,
			candidates: record.candidates
		};
	}
	return {
		classification: 'unresolved',
		libraryTrack: record.libraryTrack,
		confidence: record.confidence,
		deferred: record.deferred === true
	};
}
