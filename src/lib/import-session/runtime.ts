/**
 * Process-wide Import Session API for SvelteKit routes.
 *
 * Session File lives under `.data/` in the project cwd. Seam tests build their
 * own API with an isolated dataDir — they must not call this singleton.
 */

import { join } from 'node:path';
import { createImportSessionApi, type ImportSessionApi } from './import-session-api';

const DEFAULT_DATA_DIR = join(process.cwd(), '.data');

let runtimeApi: ImportSessionApi | undefined;

export function getRuntimeImportSessionApi(): ImportSessionApi {
	runtimeApi ??= createImportSessionApi({ dataDir: DEFAULT_DATA_DIR });
	return runtimeApi;
}
