/**
 * Reactive client locale + `t()` for Svelte UI.
 *
 * Default is Russian. Preference persists in localStorage when available.
 */

import { browser } from '$app/environment';
import {
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	interpolate,
	isAppLocale,
	type AppLocale
} from './locale';
import {
	catalogs,
	pluralSuffix,
	type MessageCatalog,
	type MessageKey
} from './messages';

let currentLocale = $state<AppLocale>(readInitialLocale());

export function getLocale(): AppLocale {
	return currentLocale;
}

export function setLocale(locale: AppLocale): void {
	currentLocale = locale;
	if (browser) {
		localStorage.setItem(LOCALE_STORAGE_KEY, locale);
		document.documentElement.lang = locale;
	}
}

export function messagesFor(locale: AppLocale = currentLocale): MessageCatalog {
	return catalogs[locale];
}

export function t(
	key: MessageKey,
	params?: Record<string, string | number>,
	locale: AppLocale = currentLocale
): string {
	return interpolate(catalogs[locale][key], params);
}

/** Translate a stable API validation code; unknown codes pass through. */
export function translateValidationCode(
	code: string,
	locale: AppLocale = currentLocale
): string {
	const key = `error.${code}` as MessageKey;
	if (key in catalogs[locale]) {
		return catalogs[locale][key];
	}
	return code;
}

export function withPlural(
	key: MessageKey,
	count: number,
	locale: AppLocale = currentLocale
): string {
	return t(key, { count, suffix: pluralSuffix(count, locale) }, locale);
}

function readInitialLocale(): AppLocale {
	if (!browser) {
		return DEFAULT_LOCALE;
	}
	const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
	if (isAppLocale(stored)) {
		return stored;
	}
	return DEFAULT_LOCALE;
}
