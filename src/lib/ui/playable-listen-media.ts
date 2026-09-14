/**
 * Svelte action: attach progressive MP3 or HLS to an `<audio>` element.
 *
 * Safari can play HLS natively; Chromium needs hls.js. Dynamic-import hls.js so
 * SSR never evaluates MediaSource APIs. After HLS attach, kick `play()` once the
 * manifest is ready (the `autoplay` attribute alone is unreliable for MSE).
 */

import type { Action } from 'svelte/action';
import type { ListenMedia } from '$lib/soundcloud/listen-media';

export const playableListenMedia: Action<HTMLAudioElement, ListenMedia> = (
	node,
	media
) => {
	let hls: { destroy(): void } | null = null;
	let generation = 0;

	function tearDown() {
		if (hls) {
			hls.destroy();
			hls = null;
		}
		node.removeAttribute('src');
		node.load();
	}

	async function apply(next: ListenMedia) {
		const gen = ++generation;
		tearDown();

		if (next.kind === 'progressive') {
			node.src = next.url;
			return;
		}

		if (node.canPlayType('application/vnd.apple.mpegurl')) {
			node.src = next.url;
			return;
		}

		const { default: Hls } = await import('hls.js');
		if (gen !== generation) {
			return;
		}
		if (!Hls.isSupported()) {
			return;
		}
		const instance = new Hls();
		hls = instance;
		instance.loadSource(next.url);
		instance.attachMedia(node);
		instance.once(Hls.Events.MANIFEST_PARSED, () => {
			if (gen !== generation) {
				return;
			}
			void node.play().catch(() => {
				/* autoplay may be blocked; controls remain */
			});
		});
	}

	void apply(media);

	return {
		update(next) {
			void apply(next);
		},
		destroy() {
			generation += 1;
			tearDown();
		}
	};
};
