/**
 * Svelte action: platform-adaptive context menu trigger.
 *
 * Desktop: `contextmenu` (right-click / Ctrl-click on macOS trackpads).
 * Touch: long-press (~480ms), cancelled on move / scroll.
 * Keyboard: Shift+F10 or ContextMenu when the host is focused.
 *
 * Does not attach to editable fields by default — native cut/copy/paste wins
 * there (web.md criticality: do not steal text-field affordances).
 */

import {
	closeContextMenu,
	openContextMenu
} from './context-menu.svelte';
import type { ContextMenuEntry } from './context-menu-types';

export type ContextMenuActionParams = {
	getEntries: () => ContextMenuEntry[];
	onSelect: (id: string) => void;
	/** When true, also intercept on INPUT/TEXTAREA (usually leave false). */
	allowOnEditable?: boolean;
};

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 10;

export function contextMenu(node: HTMLElement, params: ContextMenuActionParams) {
	let current = params;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let startX = 0;
	let startY = 0;

	function clearPress() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	function isEditableTarget(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) {
			return false;
		}
		const editable = target.closest('input, textarea, [contenteditable="true"]');
		return editable !== null;
	}

	function openAt(clientX: number, clientY: number, event: Event) {
		if (!current.allowOnEditable && isEditableTarget(event.target)) {
			return;
		}
		const entries = current.getEntries();
		if (entries.length === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		openContextMenu({
			clientX,
			clientY,
			entries,
			onSelect: current.onSelect
		});
	}

	function onContextMenu(event: MouseEvent) {
		openAt(event.clientX, event.clientY, event);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
			const rect = node.getBoundingClientRect();
			openAt(rect.left + rect.width / 2, rect.top + rect.height / 2, event);
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
			return;
		}
		if (!current.allowOnEditable && isEditableTarget(event.target)) {
			return;
		}
		startX = event.clientX;
		startY = event.clientY;
		clearPress();
		pressTimer = setTimeout(() => {
			pressTimer = null;
			openAt(startX, startY, event);
		}, LONG_PRESS_MS);
	}

	function onPointerMove(event: PointerEvent) {
		if (pressTimer === null) {
			return;
		}
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
			clearPress();
		}
	}

	function onPointerEnd() {
		clearPress();
	}

	function onScroll() {
		clearPress();
		closeContextMenu();
	}

	node.addEventListener('contextmenu', onContextMenu);
	node.addEventListener('keydown', onKeyDown);
	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerEnd);
	node.addEventListener('pointercancel', onPointerEnd);
	node.addEventListener('lostpointercapture', onPointerEnd);
	window.addEventListener('scroll', onScroll, true);

	if (!node.hasAttribute('tabindex')) {
		node.tabIndex = 0;
	}

	return {
		update(next: ContextMenuActionParams) {
			current = next;
		},
		destroy() {
			clearPress();
			node.removeEventListener('contextmenu', onContextMenu);
			node.removeEventListener('keydown', onKeyDown);
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerEnd);
			node.removeEventListener('pointercancel', onPointerEnd);
			node.removeEventListener('lostpointercapture', onPointerEnd);
			window.removeEventListener('scroll', onScroll, true);
		}
	};
}
