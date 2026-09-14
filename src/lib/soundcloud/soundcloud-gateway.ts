/**
 * SoundCloudGateway — port for SoundCloud catalog and account operations.
 *
 * Contract that Import Session orchestration (and seam tests) use so CI never
 * hits the live SoundCloud network. Catalog Match and later Import Playlist
 * flows should depend on this interface, not on fetch URLs or OAuth token files.
 *
 * Owns: identity for the connected account, catalog search for Catalog Match.
 * Playlist CRUD, library presence, and preview URLs arrive in later issues.
 *
 * Does not own: OAuth PKCE dance itself (SoundCloudAuthApi + token store),
 * Import Session / Session File, UI copy, score/classify policy.
 */

import type { SoundCloudIdentity } from './soundcloud-identity';
import type { SoundCloudTrack } from './soundcloud-track';

export type SoundCloudGateway = {
	/** Connected account identity, or null when logged out / never connected. */
	getIdentity(): Promise<SoundCloudIdentity | null>;
	/** Clears local SoundCloud credentials (and remote sign-out when live). */
	disconnect(): Promise<void>;
	/**
	 * Catalog search for Catalog Match. Query is typically artist + title.
	 * Returns zero or more SoundCloud Tracks (domain), never raw API DTOs.
	 * Empty array means no catalog hit — not a transport error.
	 */
	searchTracks(query: string): Promise<SoundCloudTrack[]>;
};
