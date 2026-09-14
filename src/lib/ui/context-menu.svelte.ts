/**
 * App-wide context menu controller (single open surface).
 *
 * One host in the root layout owns the floating UI. Callers open via
 * openContextMenu / the contextMenu action — never mount parallel menus.
 */

import type { ContextMenuRequest } from './context-menu-types';

let session = $state<ContextMenuRequest | null>(null);
let openGeneration = 0;

export function getContextMenuSession(): ContextMenuRequest | null {
	return session;
}

export function openContextMenu(request: ContextMenuRequest): void {
	if (request.entries.length === 0) {
		return;
	}
	openGeneration += 1;
	session = request;
}

export function closeContextMenu(): void {
	session = null;
}

export function selectContextMenuItem(id: string): void {
	const current = session;
	if (!current) {
		return;
	}
	const entry = current.entries.find((item) => item.type === 'item' && item.id === id);
	if (!entry || entry.type !== 'item' || entry.disabled) {
		return;
	}
	current.onSelect(id);
	closeContextMenu();
}

/** Test-only: generation bumps on each open so hosts can remeasure. */
export function getContextMenuOpenGeneration(): number {
	return openGeneration;
}
