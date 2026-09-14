/**
 * Browser-playable listen media resolved from SoundCloud `/streams`.
 *
 * Progressive `preview_mp3_128_url` is a ~30s snippet. Full tracks (and longer
 * listen for Match Resolution) need HLS (`hls_aac_*` / `hls_mp3_*`) played with
 * native Safari HLS or hls.js. Prefer full HLS, then progressive full MP3 when
 * still offered, then the short preview as last resort.
 */

export type ListenMediaKind = 'progressive' | 'hls';

export type ListenMedia = {
	url: string;
	kind: ListenMediaKind;
};

/** Infer kind from a known URL (fakes / optional track.previewUrl). */
export function listenMediaKindFromUrl(url: string): ListenMediaKind {
	const path = (() => {
		try {
			return new URL(url).pathname.toLowerCase();
		} catch {
			return url.toLowerCase();
		}
	})();
	if (path.includes('.m3u8') || path.includes('/playlist')) {
		return 'hls';
	}
	return 'progressive';
}
