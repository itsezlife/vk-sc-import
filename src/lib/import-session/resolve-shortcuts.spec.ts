import { describe, expect, it } from 'vitest';
import {
	resolveShortcutFor,
	SEEK_LONG_STEP_SECONDS,
	SEEK_STEP_SECONDS,
	type ResolveKeyInput
} from './resolve-shortcuts';

function press(key: string, code: string, mods: Partial<ResolveKeyInput> = {}) {
	return resolveShortcutFor({
		key,
		code,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...mods
	});
}

describe('resolve-shortcuts (pure)', () => {
	it('moves the highlight with arrows and j/k', () => {
		expect(press('ArrowDown', 'ArrowDown')).toEqual({ kind: 'move', delta: 1 });
		expect(press('ArrowUp', 'ArrowUp')).toEqual({ kind: 'move', delta: -1 });
		expect(press('j', 'KeyJ')).toEqual({ kind: 'move', delta: 1 });
		expect(press('k', 'KeyK')).toEqual({ kind: 'move', delta: -1 });
	});

	it('maps Enter, Space, S, /, O to submit, listen, skip, search, open', () => {
		expect(press('Enter', 'Enter')).toEqual({ kind: 'submit' });
		expect(press(' ', 'Space')).toEqual({ kind: 'listen' });
		expect(press('s', 'KeyS')).toEqual({ kind: 'skip' });
		expect(press('/', 'Slash')).toEqual({ kind: 'search' });
		expect(press('o', 'KeyO')).toEqual({ kind: 'open' });
	});

	it('matches physical keys under a Russian layout', () => {
		expect(press('ы', 'KeyS')).toEqual({ kind: 'skip' });
		expect(press('.', 'Slash')).toEqual({ kind: 'search' });
		expect(press('о', 'KeyJ')).toEqual({ kind: 'move', delta: 1 });
	});

	it('chooses the Nth choice with digits 1–9 (row and numpad)', () => {
		expect(press('1', 'Digit1')).toEqual({ kind: 'choose', index: 0 });
		expect(press('9', 'Numpad9')).toEqual({ kind: 'choose', index: 8 });
		expect(press('0', 'Digit0')).toBeNull();
	});

	it('seeks with left/right, longer with Shift', () => {
		expect(press('ArrowLeft', 'ArrowLeft')).toEqual({
			kind: 'seek',
			seconds: -SEEK_STEP_SECONDS
		});
		expect(press('ArrowRight', 'ArrowRight', { shiftKey: true })).toEqual({
			kind: 'seek',
			seconds: SEEK_LONG_STEP_SECONDS
		});
	});

	it('maps Cmd+S / Ctrl+S to back, also under a Russian layout', () => {
		expect(press('s', 'KeyS', { metaKey: true })).toEqual({ kind: 'back' });
		expect(press('s', 'KeyS', { ctrlKey: true })).toEqual({ kind: 'back' });
		expect(press('ы', 'KeyS', { metaKey: true })).toEqual({ kind: 'back' });
		expect(press('s', 'KeyS', { metaKey: true, shiftKey: true })).toBeNull();
	});

	it('leaves browser chords and other Shift combos alone', () => {
		expect(press('k', 'KeyK', { metaKey: true })).toBeNull();
		expect(press('Enter', 'Enter', { ctrlKey: true })).toBeNull();
		expect(press('ArrowLeft', 'ArrowLeft', { altKey: true })).toBeNull();
		expect(press('?', 'Slash', { shiftKey: true })).toBeNull();
		expect(press('Enter', 'Enter', { shiftKey: true })).toBeNull();
		expect(press('x', 'KeyX')).toBeNull();
	});
});
