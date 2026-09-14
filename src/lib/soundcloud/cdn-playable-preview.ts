/**
 * Whether a listen URL is safe for in-app `<audio>` (CDN progressive/HLS).
 *
 * SoundCloud `api.soundcloud.com` stream URLs need OAuth and fail in the
 * browser player — Match Resolution and Rematch both gate on this before
 * attaching media or calling `resolveListenMedia`.
 */
export function isCdnPlayablePreview(url: string): boolean {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host !== 'api.soundcloud.com' && !host.endsWith('.api.soundcloud.com');
	} catch {
		return false;
	}
}
