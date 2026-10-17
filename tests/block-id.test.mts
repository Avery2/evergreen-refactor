import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	createBlockId,
	formatTimestamp,
	isValidBlockId,
	newBlockId,
} from '../src/block-id.ts';

describe('formatTimestamp', () => {
	it('formats local time as YYYYMMDD-HHmmss', () => {
		const date = new Date(2026, 9, 16, 16, 43, 0);
		assert.equal(formatTimestamp(date), '20261016-164300');
	});

	it('pads single-digit months, days and times', () => {
		const date = new Date(2026, 0, 2, 3, 4, 5);
		assert.equal(formatTimestamp(date), '20260102-030405');
	});
});

describe('createBlockId', () => {
	it('matches the shape used in the README', () => {
		const date = new Date(2026, 9, 16, 16, 43, 0);
		assert.equal(createBlockId(date, 'a7c9'), '20261016-164300-a7c9');
	});

	it('lowercases and strips anything Obsidian would not accept', () => {
		const date = new Date(2026, 9, 16, 16, 43, 0);
		assert.equal(createBlockId(date, 'A7_C9!!'), '20261016-164300-a7c9');
	});

	it('produces ids Obsidian can resolve', () => {
		assert.equal(isValidBlockId(createBlockId(new Date(), 'a7c9')), true);
	});
});

describe('newBlockId', () => {
	it('is unique across rapid calls', () => {
		const ids = new Set(Array.from({ length: 500 }, () => newBlockId()));
		assert.ok(ids.size > 480, `expected mostly unique ids, got ${ids.size}/500`);
	});

	it('never contains characters that would break a link', () => {
		for (let i = 0; i < 200; i += 1) {
			assert.match(newBlockId(), /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/);
		}
	});
});

describe('isValidBlockId', () => {
	it('rejects empty and unsafe ids', () => {
		assert.equal(isValidBlockId(''), false);
		assert.equal(isValidBlockId('has space'), false);
		assert.equal(isValidBlockId('has#hash'), false);
		assert.equal(isValidBlockId('ok-id-123'), true);
	});
});
