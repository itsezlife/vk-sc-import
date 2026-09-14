import { describe, expect, it } from 'vitest';
import { interpolate } from './locale';
import { catalogs } from './messages';

describe('i18n catalogs', () => {
	it('keeps Russian and English catalogs on the same key set', () => {
		expect(Object.keys(catalogs.ru).sort()).toEqual(Object.keys(catalogs.en).sort());
	});

	it('interpolates placeholders', () => {
		expect(interpolate('Загружено треков: {count}', { count: 3 })).toBe(
			'Загружено треков: 3'
		);
	});

	it('uses Russian as the primary default catalog content for the start headline', () => {
		expect(catalogs.ru['guidance.startHeadline']).toBe('Начните Import Session');
		expect(catalogs.en['guidance.startHeadline']).toBe('Start your Import Session');
	});
});
