/**
 * Viewport-aware placement for a floating context menu.
 *
 * Prefers opening below-right of the pointer. Flips above / left when the menu
 * would overflow — the viewport is material (web.md), not a fixed offset guess.
 */

export type MenuSize = {
	width: number;
	height: number;
};

export type ViewportBox = {
	width: number;
	height: number;
};

export type MenuPoint = {
	x: number;
	y: number;
};

export type PositionedMenu = {
	left: number;
	top: number;
	/** True when the menu was flipped horizontally to stay in view. */
	flippedX: boolean;
	/** True when the menu was flipped vertically to stay in view. */
	flippedY: boolean;
};

export type PositionMenuOptions = {
	pointer: MenuPoint;
	menu: MenuSize;
	viewport: ViewportBox;
	/** Inset from viewport edges. */
	padding?: number;
	/** Gap from the pointer so the cursor does not cover the first item. */
	pointerOffset?: number;
};

/**
 * Computes fixed-position coordinates for a context menu.
 */
export function positionMenu(options: PositionMenuOptions): PositionedMenu {
	const padding = options.padding ?? 8;
	const pointerOffset = options.pointerOffset ?? 2;
	const { pointer, menu, viewport } = options;

	let left = pointer.x + pointerOffset;
	let top = pointer.y + pointerOffset;
	let flippedX = false;
	let flippedY = false;

	const maxLeft = Math.max(padding, viewport.width - menu.width - padding);
	const maxTop = Math.max(padding, viewport.height - menu.height - padding);

	if (left + menu.width > viewport.width - padding) {
		left = pointer.x - menu.width - pointerOffset;
		flippedX = true;
	}
	if (top + menu.height > viewport.height - padding) {
		top = pointer.y - menu.height - pointerOffset;
		flippedY = true;
	}

	left = clamp(left, padding, maxLeft);
	top = clamp(top, padding, maxTop);

	return { left, top, flippedX, flippedY };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
