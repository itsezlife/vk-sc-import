/**
 * Domain-free context menu model for the ui-kit.
 *
 * Entries are presentation contracts: the host supplies labels (already
 * localized). Domain logic stays in the caller’s onSelect — the menu never
 * knows about Import Session or Source Library.
 */

export type ContextMenuItem = {
	type: 'item';
	id: string;
	label: string;
	disabled?: boolean;
	danger?: boolean;
	shortcut?: string;
};

export type ContextMenuSeparator = {
	type: 'separator';
};

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export type ContextMenuRequest = {
	clientX: number;
	clientY: number;
	entries: ContextMenuEntry[];
	onSelect: (id: string) => void;
};
