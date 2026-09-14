/**
 * Connected SoundCloud account identity shown in the UI and held by the gateway.
 *
 * Deliberately not the `/me` API DTO: no avatar, plan, or transport fields.
 * Tokens never live on this type — they stay in the auth token store only.
 */

export type SoundCloudIdentity = {
	/** SoundCloud numeric user id as a string (API returns number; we keep string). */
	id: string;
	username: string;
	permalinkUrl?: string;
};
