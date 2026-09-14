/**
 * Import Playlist — SoundCloud playlist identity for one Import Session write.
 *
 * Domain shape after the gateway maps playlist create responses. Lives next to
 * SoundCloudTrack so catalog/playlist HTTP and SoundCloudGateway never import
 * Import Session types. Session File stores this identity so Rematch and review
 * can address the same playlist without re-creating it.
 *
 * Owns: playlist identity fields.
 * Does not own: dated title convention (Import Session), Match Record flags,
 * Session File I/O, SoundCloud HTTP.
 */

export type ImportPlaylist = {
	id: string;
	title: string;
	permalinkUrl?: string;
};

/**
 * Parses an already-decoded domain-shaped playlist object (Session File /
 * gateway return). Returns null when required fields are missing.
 */
export function parseImportPlaylist(row: unknown): ImportPlaylist | null {
	if (row === null || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	if (typeof record.id !== 'string' || typeof record.title !== 'string') {
		return null;
	}
	if (!record.id.trim() || !record.title.trim()) {
		return null;
	}
	const permalinkUrl = record.permalinkUrl;
	if (permalinkUrl !== undefined && typeof permalinkUrl !== 'string') {
		return null;
	}
	return {
		id: record.id,
		title: record.title,
		...(typeof permalinkUrl === 'string' ? { permalinkUrl } : {})
	};
}
