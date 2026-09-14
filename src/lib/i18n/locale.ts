/**
 * Client locales for UI copy. Russian is the product default; English is optional.
 * API / Session File / domain code stay English (CONTEXT.md). Only user-facing
 * chrome goes through these catalogs.
 */

export type AppLocale = 'ru' | 'en';

export const DEFAULT_LOCALE: AppLocale = 'ru';

export const LOCALE_STORAGE_KEY = 'vk-sc-import.locale';

export function isAppLocale(value: unknown): value is AppLocale {
	return value === 'ru' || value === 'en';
}

/** Replace `{name}` placeholders; missing keys stay as the brace token. */
export function interpolate(
	template: string,
	params?: Record<string, string | number>
): string {
	if (!params) {
		return template;
	}
	return template.replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = params[name];
		return value === undefined ? `{${name}}` : String(value);
	});
}
