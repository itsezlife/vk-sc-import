/**
 * UI message catalogs (ru primary, en secondary).
 *
 * Keys are stable contracts for the client; do not reuse a key for a different
 * sentence. Domain nouns in copy follow CONTEXT.md meaning even when translated.
 */

import type { AppLocale } from './locale';

export type MessageKey =
	| 'meta.description'
	| 'brand.tagline'
	| 'locale.switcherLabel'
	| 'locale.ru'
	| 'locale.en'
	| 'status.done'
	| 'status.needed'
	| 'status.soon'
	| 'shell.restoringHeadline'
	| 'shell.restoringSummary'
	| 'shell.restoring'
	| 'soundcloud.connect'
	| 'soundcloud.connecting'
	| 'soundcloud.disconnect'
	| 'soundcloud.disconnecting'
	| 'soundcloud.connectedAs'
	| 'soundcloud.connectFailed'
	| 'soundcloud.logoutFailed'
	| 'soundcloud.restoreFailed'
	| 'soundcloud.errorAuthorizeDenied'
	| 'soundcloud.errorMissingCode'
	| 'soundcloud.errorCompleteFailed'
	| 'guidance.connectDetail'
	| 'guidance.libraryDetail'
	| 'guidance.stepConnect'
	| 'guidance.stepLibrary'
	| 'guidance.readyHeadline'
	| 'guidance.readySummary'
	| 'guidance.startHeadline'
	| 'guidance.startSummary'
	| 'guidance.needLibraryHeadline'
	| 'guidance.needLibrarySummary'
	| 'guidance.needConnectHeadline'
	| 'guidance.needConnectSummary'
	| 'guidance.readyBanner'
	| 'library.format'
	| 'library.upload'
	| 'library.paste'
	| 'library.load'
	| 'library.loading'
	| 'library.tracksLoaded'
	| 'library.andMore'
	| 'library.rowsSkipped'
	| 'library.rowLabel'
	| 'library.ingestOk'
	| 'library.ingestNoValid'
	| 'library.restoreHttpError'
	| 'library.restoreFailed'
	| 'library.ingestFailed'
	| 'match.run'
	| 'match.running'
	| 'match.progress'
	| 'match.done'
	| 'match.failed'
	| 'match.buckets'
	| 'menu.ariaLabel'
	| 'menu.copyArtist'
	| 'menu.copyTitle'
	| 'menu.copyLine'
	| 'error.library_track_requires_artist_title'
	| 'error.source_library_json_invalid'
	| 'error.source_library_json_shape'
	| 'error.source_library_csv_empty'
	| 'error.source_library_csv_headers'
	| 'error.request_body_must_be_json'
	| 'error.format_must_be_json_or_csv'
	| 'error.content_must_be_string';

export type MessageCatalog = Record<MessageKey, string>;

const ru: MessageCatalog = {
	'meta.description':
		'Локальное каталожное сопоставление лайков ВК (Source Library) в Import Playlist на SoundCloud.',
	'brand.tagline':
		'Каталожное сопоставление Source Library лайков ВК в Import Playlist на SoundCloud.',
	'locale.switcherLabel': 'Язык',
	'locale.ru': 'Русский',
	'locale.en': 'English',
	'status.done': 'Готово',
	'status.needed': 'Нужно',
	'status.soon': 'скоро',
	'shell.restoringHeadline': 'Восстановление…',
	'shell.restoringSummary':
		'Читаем локальное подключение SoundCloud и Import Session с диска.',
	'shell.restoring': 'Загрузка сохранённого состояния',
	'soundcloud.connect': 'Подключить SoundCloud',
	'soundcloud.connecting': 'Переход к SoundCloud…',
	'soundcloud.disconnect': 'Отключить',
	'soundcloud.disconnecting': 'Отключение…',
	'soundcloud.connectedAs': 'Подключено как {username}',
	'soundcloud.connectFailed':
		'Не удалось начать вход в SoundCloud. Проверьте SOUNDCLOUD_CLIENT_ID в .env.',
	'soundcloud.logoutFailed': 'Не удалось отключить SoundCloud.',
	'soundcloud.restoreFailed': 'Не удалось восстановить подключение SoundCloud.',
	'soundcloud.errorAuthorizeDenied': 'Вход в SoundCloud отклонён.',
	'soundcloud.errorMissingCode': 'SoundCloud не вернул код авторизации.',
	'soundcloud.errorCompleteFailed':
		'Не удалось завершить вход в SoundCloud. Попробуйте ещё раз.',
	'guidance.connectDetail':
		'Войдите, чтобы записывать совпадения в ваш Import Playlist.',
	'guidance.libraryDetail':
		'Загрузите лайки ВК как Source Library — строки artist + title.',
	'guidance.stepConnect': 'Подключить SoundCloud',
	'guidance.stepLibrary': 'Загрузить Source Library',
	'guidance.readyHeadline': 'Готово к каталожному сопоставлению',
	'guidance.readySummary':
		'SoundCloud подключён, Source Library загружена. Дальше — каталожное сопоставление.',
	'guidance.startHeadline': 'Начните Import Session',
	'guidance.startSummary':
		'Подключите SoundCloud и загрузите Source Library, чтобы сопоставить лайки ВК с Import Playlist.',
	'guidance.needLibraryHeadline': 'Загрузите Source Library',
	'guidance.needLibrarySummary':
		'SoundCloud подключён. Загрузите Source Library, чтобы начать каталожное сопоставление.',
	'guidance.needConnectHeadline': 'Подключите SoundCloud',
	'guidance.needConnectSummary':
		'Source Library загружена. Подключите SoundCloud перед записью Import Playlist.',
	'guidance.readyBanner':
		'Можно запускать каталожное сопоставление.',
	'library.format': 'Формат',
	'library.upload': 'Загрузить файл',
	'library.paste': 'Или вставьте Source Library',
	'library.load': 'Загрузить Source Library',
	'library.loading': 'Загрузка…',
	'library.tracksLoaded': 'Загружено треков: {count}',
	'library.andMore': '…и ещё {count}',
	'library.rowsSkipped': 'Пропущено строк: {count}',
	'library.rowLabel': 'Строка {row}',
	'library.ingestOk': 'Загружено Library Track: {count}.',
	'library.ingestNoValid':
		'Нет валидных Library Track — существующая Import Session (если была) не изменена.',
	'library.restoreHttpError':
		'Не удалось восстановить Import Session (HTTP {status}).',
	'library.restoreFailed':
		'Не удалось восстановить Import Session через локальный API.',
	'library.ingestFailed': 'Не удалось обратиться к локальному Import Session API.',
	'match.run': 'Запустить Catalog Match',
	'match.running': 'Идёт Catalog Match…',
	'match.progress': 'Сопоставлено {completed} из {total}',
	'match.done':
		'Catalog Match готов: Auto {auto}, Ambiguous {ambiguous}, Unresolved {unresolved}.',
	'match.failed': 'Не удалось выполнить Catalog Match: {message}',
	'match.buckets':
		'Match Records — Auto: {auto}, Ambiguous: {ambiguous}, Unresolved: {unresolved}',
	'menu.ariaLabel': 'Контекстное меню',
	'menu.copyArtist': 'Копировать исполнителя',
	'menu.copyTitle': 'Копировать название',
	'menu.copyLine': 'Копировать строку',
	'error.library_track_requires_artist_title':
		'У Library Track нужны artist и title',
	'error.source_library_json_invalid': 'JSON Source Library некорректен',
	'error.source_library_json_shape':
		'JSON Source Library должен быть массивом треков или { "tracks": [...] }',
	'error.source_library_csv_empty': 'CSV Source Library пуст',
	'error.source_library_csv_headers':
		'В CSV Source Library нужны колонки artist и title',
	'error.request_body_must_be_json': 'Тело запроса должно быть JSON',
	'error.format_must_be_json_or_csv': 'format должен быть "json" или "csv"',
	'error.content_must_be_string': 'content должен быть строкой'
};

const en: MessageCatalog = {
	'meta.description':
		'Local catalog match from a VK likes Source Library into a SoundCloud Import Playlist.',
	'brand.tagline':
		'Catalog-match a Source Library of VK likes into a SoundCloud Import Playlist.',
	'locale.switcherLabel': 'Language',
	'locale.ru': 'Русский',
	'locale.en': 'English',
	'status.done': 'Done',
	'status.needed': 'Needed',
	'status.soon': 'soon',
	'shell.restoringHeadline': 'Restoring…',
	'shell.restoringSummary':
		'Reading your local SoundCloud connection and Import Session from disk.',
	'shell.restoring': 'Loading saved state',
	'soundcloud.connect': 'Connect SoundCloud',
	'soundcloud.connecting': 'Redirecting to SoundCloud…',
	'soundcloud.disconnect': 'Disconnect',
	'soundcloud.disconnecting': 'Disconnecting…',
	'soundcloud.connectedAs': 'Connected as {username}',
	'soundcloud.connectFailed':
		'Could not start SoundCloud sign-in. Check SOUNDCLOUD_CLIENT_ID in .env.',
	'soundcloud.logoutFailed': 'Could not disconnect SoundCloud.',
	'soundcloud.restoreFailed':
		'Could not restore the SoundCloud connection.',
	'soundcloud.errorAuthorizeDenied': 'SoundCloud sign-in was denied.',
	'soundcloud.errorMissingCode': 'SoundCloud did not return an authorization code.',
	'soundcloud.errorCompleteFailed':
		'Could not finish SoundCloud sign-in. Try again.',
	'guidance.connectDetail':
		'Sign in so matched tracks can be written to your Import Playlist.',
	'guidance.libraryDetail':
		'Provide your VK likes as a Source Library of artist + title rows.',
	'guidance.stepConnect': 'Connect SoundCloud',
	'guidance.stepLibrary': 'Load Source Library',
	'guidance.readyHeadline': 'Ready to catalog match',
	'guidance.readySummary':
		'SoundCloud is connected and a Source Library is loaded. Catalog matching comes next.',
	'guidance.startHeadline': 'Start your Import Session',
	'guidance.startSummary':
		'Connect SoundCloud and load a Source Library to catalog-match VK likes into an Import Playlist.',
	'guidance.needLibraryHeadline': 'Load a Source Library',
	'guidance.needLibrarySummary':
		'SoundCloud is connected. Load a Source Library to start catalog matching.',
	'guidance.needConnectHeadline': 'Connect SoundCloud',
	'guidance.needConnectSummary':
		'Source Library is loaded. Connect SoundCloud before writing an Import Playlist.',
	'guidance.readyBanner':
		'You can run Catalog Match now.',
	'library.format': 'Format',
	'library.upload': 'Upload file',
	'library.paste': 'Or paste Source Library',
	'library.load': 'Load Source Library',
	'library.loading': 'Loading…',
	'library.tracksLoaded': '{count} Library Track{suffix} loaded',
	'library.andMore': '…and {count} more',
	'library.rowsSkipped': '{count} row{suffix} skipped',
	'library.rowLabel': 'Row {row}',
	'library.ingestOk': 'Loaded {count} Library Track{suffix}.',
	'library.ingestNoValid':
		'No valid Library Tracks — existing Import Session (if any) was left unchanged.',
	'library.restoreHttpError':
		'Could not restore Import Session (HTTP {status}).',
	'library.restoreFailed':
		'Could not restore Import Session from the local API.',
	'library.ingestFailed': 'Could not reach the local Import Session API.',
	'match.run': 'Run Catalog Match',
	'match.running': 'Running Catalog Match…',
	'match.progress': 'Matched {completed} of {total}',
	'match.done':
		'Catalog Match complete: Auto {auto}, Ambiguous {ambiguous}, Unresolved {unresolved}.',
	'match.failed': 'Catalog Match failed: {message}',
	'match.buckets':
		'Match Records — Auto: {auto}, Ambiguous: {ambiguous}, Unresolved: {unresolved}',
	'menu.ariaLabel': 'Context menu',
	'menu.copyArtist': 'Copy artist',
	'menu.copyTitle': 'Copy title',
	'menu.copyLine': 'Copy line',
	'error.library_track_requires_artist_title':
		'Library Track requires artist and title',
	'error.source_library_json_invalid': 'Source Library JSON is not valid',
	'error.source_library_json_shape':
		'Source Library JSON must be an array of tracks or { "tracks": [...] }',
	'error.source_library_csv_empty': 'Source Library CSV is empty',
	'error.source_library_csv_headers':
		'Source Library CSV requires artist and title columns',
	'error.request_body_must_be_json': 'Request body must be JSON',
	'error.format_must_be_json_or_csv': 'format must be "json" or "csv"',
	'error.content_must_be_string': 'content must be a string'
};

export const catalogs: Record<AppLocale, MessageCatalog> = { ru, en };

export function pluralSuffix(count: number, locale: AppLocale): string {
	if (locale === 'en') {
		return count === 1 ? '' : 's';
	}
	return '';
}
