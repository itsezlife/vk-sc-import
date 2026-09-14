/**
 * One row in a Source Library: the minimum identity Catalog Match needs.
 *
 * Artist + title are required after trim. Optional export ids belong in later
 * issues — this type stays the stable core of Library Track for Import Session.
 */

/** Canonical Library Track after ingest validation. */
export type LibraryTrack = {
	artist: string;
	title: string;
};

/**
 * A Source Library row that failed validation.
 *
 * `row` is 1-based in the source payload (JSON array index, or CSV file line
 * including the header). `message` is a stable ValidationCode for client i18n.
 * Partial artist/title are kept so the UI can show what was rejected without
 * inventing placeholders.
 */
export type LibraryRowValidationError = {
	row: number;
	message: string;
	artist?: string;
	title?: string;
};
