import { describe, expect, it } from 'vitest';
import { positionMenu } from './context-menu-position';

describe('positionMenu', () => {
	const menu = { width: 200, height: 120 };
	const viewport = { width: 1000, height: 800 };

	it('opens below-right of the pointer when there is room', () => {
		const placed = positionMenu({
			pointer: { x: 100, y: 80 },
			menu,
			viewport,
			pointerOffset: 2,
			padding: 8
		});

		expect(placed).toEqual({
			left: 102,
			top: 82,
			flippedX: false,
			flippedY: false
		});
	});

	it('flips left when the menu would overflow the right edge', () => {
		const placed = positionMenu({
			pointer: { x: 950, y: 100 },
			menu,
			viewport,
			pointerOffset: 2,
			padding: 8
		});

		expect(placed.flippedX).toBe(true);
		expect(placed.left).toBe(950 - 200 - 2);
		expect(placed.top).toBe(102);
	});

	it('flips above when the menu would overflow the bottom edge', () => {
		const placed = positionMenu({
			pointer: { x: 120, y: 760 },
			menu,
			viewport,
			pointerOffset: 2,
			padding: 8
		});

		expect(placed.flippedY).toBe(true);
		expect(placed.top).toBe(760 - 120 - 2);
		expect(placed.left).toBe(122);
	});

	it('clamps into the padded viewport when the pointer is in a corner', () => {
		const placed = positionMenu({
			pointer: { x: 990, y: 790 },
			menu,
			viewport,
			pointerOffset: 2,
			padding: 8
		});

		expect(placed.left).toBe(990 - 200 - 2);
		expect(placed.top).toBe(790 - 120 - 2);
		expect(placed.flippedX).toBe(true);
		expect(placed.flippedY).toBe(true);
	});
});
