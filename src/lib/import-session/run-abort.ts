/**
 * Abort contract for paced Catalog Match / Import Playlist write runs.
 *
 * Hosts pass `AbortSignal` (UI cancel or disconnect). After each completed
 * unit of work the Session File is already persisted — abort never rolls back
 * that progress. `isRunAbortedError` lets HTTP/UI treat cancel as a controlled
 * stop, not a transport failure.
 */

export class ImportSessionRunAbortedError extends Error {
	readonly name = 'AbortError';

	constructor(message = 'Import Session run aborted') {
		super(message);
	}
}

export function isRunAbortedError(error: unknown): boolean {
	if (error instanceof ImportSessionRunAbortedError) {
		return true;
	}
	if (error instanceof Error && error.name === 'AbortError') {
		return true;
	}
	return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new ImportSessionRunAbortedError();
	}
}

/**
 * Interruptible pause for rate-limit pacing. Resolves early by rejecting with
 * `ImportSessionRunAbortedError` when `signal` aborts.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		throwIfAborted(signal);
		return Promise.resolve();
	}
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new ImportSessionRunAbortedError());
		};
		if (!signal) {
			return;
		}
		if (signal.aborted) {
			clearTimeout(timer);
			reject(new ImportSessionRunAbortedError());
			return;
		}
		signal.addEventListener('abort', onAbort, { once: true });
	});
}
