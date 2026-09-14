/**
 * Stable validation codes returned by Source Library ingest / session API.
 *
 * Client maps these through i18n (`error.<code>`). Tests assert codes, not copy.
 */

export const ValidationCode = {
	libraryTrackRequiresArtistTitle: 'library_track_requires_artist_title',
	sourceLibraryJsonInvalid: 'source_library_json_invalid',
	sourceLibraryJsonShape: 'source_library_json_shape',
	sourceLibraryCsvEmpty: 'source_library_csv_empty',
	sourceLibraryCsvHeaders: 'source_library_csv_headers',
	requestBodyMustBeJson: 'request_body_must_be_json',
	formatMustBeJsonOrCsv: 'format_must_be_json_or_csv',
	contentMustBeString: 'content_must_be_string'
} as const;

export type ValidationCode =
	(typeof ValidationCode)[keyof typeof ValidationCode];
