/**
 * Dated Import Playlist title convention for one Import Session write.
 *
 * Owns: `VK import YYYY-MM-DD` naming (UTC calendar date of `now`).
 * Does not own: SoundCloud playlist identity fields (see soundcloud/import-playlist).
 */

/**
 * Clear dated title for the Import Playlist (e.g. `VK import 2026-09-14`).
 * Uses the UTC calendar date of `now` so seam tests can pin the name.
 */
export function importPlaylistTitle(now: Date): string {
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(now.getUTCDate()).padStart(2, '0');
	return `VK import ${yyyy}-${mm}-${dd}`;
}
