/**
 * SoundCloud Track — catalog identity usable in a Match Record / Import Playlist.
 *
 * Domain shape after the gateway maps API DTOs. UI and Import Session never see
 * raw SoundCloud JSON keys (`user.username`, `permalink_url`, …).
 */

export type SoundCloudTrack = {
	id: string;
	title: string;
	/** Display artist (uploader username or publisher metadata when mapped). */
	artist: string;
	permalinkUrl?: string;
};
