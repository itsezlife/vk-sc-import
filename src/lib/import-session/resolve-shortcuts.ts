/**
 * Match Resolution keyboard map — pure keystroke → intent translation.
 *
 * The journey (MatchResolutionPanel) owns what each intent does (queue head,
 * listen slot, fetch); this module only decides which keystroke means which
 * intent, so the map is testable without a DOM.
 *
 * Letters, digits, and `/` match on `event.code` (physical key), not
 * `event.key`: with a Russian layout active `S` arrives as `ы` and `/` as `.`,
 * so a `key`-based map would silently stop working whenever the user last
 * typed Cyrillic.
 */

export type ResolveShortcut =
	| { kind: 'move'; delta: 1 | -1 }
	/** Zero-based index into the combined candidates + search hits list. */
	| { kind: 'choose'; index: number }
	| { kind: 'submit' }
	| { kind: 'listen' }
	| { kind: 'seek'; seconds: number }
	| { kind: 'skip' }
	/** Undo the last pick / bind / skip and bring that track back. */
	| { kind: 'back' }
	| { kind: 'search' }
	| { kind: 'open' };

export type ResolveKeyInput = Pick<
	KeyboardEvent,
	'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

export const SEEK_STEP_SECONDS = 10;
export const SEEK_LONG_STEP_SECONDS = 30;

const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

export function resolveShortcutFor(input: ResolveKeyInput): ResolveShortcut | null {
	// Cmd+S (Ctrl+S off macOS) is the one chord taken from the browser: "save
	// page" is useless in this tool, and S already means skip, so the chord
	// reads as "undo skip".
	if ((input.metaKey || input.ctrlKey) && !input.altKey && !input.shiftKey) {
		return input.code === 'KeyS' ? { kind: 'back' } : null;
	}
	// Every other browser / OS chord (Ctrl+K, Alt+←, Cmd+Shift+S) stays native.
	if (input.altKey || input.ctrlKey || input.metaKey) {
		return null;
	}

	if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
		const step = input.shiftKey ? SEEK_LONG_STEP_SECONDS : SEEK_STEP_SECONDS;
		return { kind: 'seek', seconds: input.key === 'ArrowLeft' ? -step : step };
	}

	// Shift is only meaningful for seek; Shift+/ is `?`, Shift+Enter is not submit.
	if (input.shiftKey) {
		return null;
	}

	if (input.key === 'ArrowDown' || input.code === 'KeyJ') {
		return { kind: 'move', delta: 1 };
	}
	if (input.key === 'ArrowUp' || input.code === 'KeyK') {
		return { kind: 'move', delta: -1 };
	}
	if (input.key === 'Enter') {
		return { kind: 'submit' };
	}
	if (input.code === 'Space') {
		return { kind: 'listen' };
	}
	if (input.code === 'KeyS') {
		return { kind: 'skip' };
	}
	if (input.code === 'Slash') {
		return { kind: 'search' };
	}
	if (input.code === 'KeyO') {
		return { kind: 'open' };
	}

	const digit = DIGIT_CODE.exec(input.code);
	if (digit) {
		return { kind: 'choose', index: Number(digit[1]) - 1 };
	}

	return null;
}
