/**
 * SoundCloud Track — catalog identity usable in a Match Record / Import Playlist.
 *
 * Domain shape after the gateway maps API DTOs. UI and Import Session never see
 * raw SoundCloud JSON keys (`user.username`, `permalink_url`, `stream_url`, …).
 *
 * Listen: resolve CDN media via SoundCloudGateway `resolveListenMedia`
 * (`/tracks/{urn}/streams` → progressive or HLS). Optional `previewUrl` is only
 * for fakes/tests that already know a playable URL — never map live
 * `stream_url` here (OAuth-gated). When resolve returns null, open
 * `permalinkUrl` on SoundCloud.
 */

export type SoundCloudTrack = {
	id: string;
	title: string;
	/** Display artist (uploader username or publisher metadata when mapped). */
	artist: string;
	permalinkUrl?: string;
	/** Full track length from catalog (`duration` ms). Absent when source omitted it. */
	durationMs?: number;
	/** Square-ish artwork CDN URL for Match Resolution cards. */
	artworkUrl?: string;
	/**
	 * Optional playable URL (tests / already-resolved). Live catalog search
	 * leaves this unset; UI resolves on Listen (may be HLS or progressive).
	 */
	previewUrl?: string;
};

/**
 * Parses an already-decoded domain-shaped object (Session File / HTTP body).
 * Returns null when required fields are missing — does not accept API snake_case.
 */
export function parseSoundCloudTrack(row: unknown): SoundCloudTrack | null {
	if (row === null || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	if (
		typeof record.id !== 'string' ||
		typeof record.title !== 'string' ||
		typeof record.artist !== 'string'
	) {
		return null;
	}
	const permalinkUrl = record.permalinkUrl;
	if (permalinkUrl !== undefined && typeof permalinkUrl !== 'string') {
		return null;
	}
	const previewUrl = record.previewUrl;
	if (previewUrl !== undefined && typeof previewUrl !== 'string') {
		return null;
	}
	const artworkUrl = record.artworkUrl;
	if (artworkUrl !== undefined && typeof artworkUrl !== 'string') {
		return null;
	}
	const durationMs = record.durationMs;
	if (
		durationMs !== undefined &&
		(typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0)
	) {
		return null;
	}
	return {
		id: record.id,
		title: record.title,
		artist: record.artist,
		...(typeof permalinkUrl === 'string' ? { permalinkUrl } : {}),
		...(typeof artworkUrl === 'string' ? { artworkUrl } : {}),
		...(typeof durationMs === 'number' ? { durationMs } : {}),
		...(typeof previewUrl === 'string' ? { previewUrl } : {})
	};
}

/** `m:ss` / `h:mm:ss` for Match Resolution meta — not i18n (digits only). */
export function formatTrackDuration(durationMs: number): string {
	const totalSec = Math.max(0, Math.floor(durationMs / 1000));
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;
	const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
	const ss = String(seconds).padStart(2, '0');
	return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
