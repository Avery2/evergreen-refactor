import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { joinVaultPath, sanitizeNoteTitle } from '../src/destination-path.ts';
import { coerceSettings } from '../src/types.ts';
import { DEFAULT_SETTINGS } from '../src/types.ts';

describe('sanitizeNoteTitle', () => {
	it('keeps ordinary titles', () => {
		assert.equal(sanitizeNoteTitle('Improving relationships'), 'Improving relationships');
		assert.equal(sanitizeNoteTitle('Relationship with my mom'), 'Relationship with my mom');
	});

	it('removes path separators', () => {
		assert.equal(sanitizeNoteTitle('a/b'), 'a b');
		assert.equal(sanitizeNoteTitle('a:b'), 'a b');
	});

	it('removes characters that would break a wiki link', () => {
		assert.equal(sanitizeNoteTitle('notes #1'), 'notes 1');
		assert.equal(sanitizeNoteTitle('a|b'), 'a b');
		assert.equal(sanitizeNoteTitle('a[b]'), 'a b');
		assert.equal(sanitizeNoteTitle('a^b'), 'a b');
	});

	it('collapses whitespace and trims trailing dots', () => {
		assert.equal(sanitizeNoteTitle('  spaced   out  '), 'spaced out');
		assert.equal(sanitizeNoteTitle('trailing...'), 'trailing');
	});
});

describe('joinVaultPath', () => {
	it('puts notes in the vault root when no folder is set', () => {
		assert.equal(joinVaultPath('', 'Note'), 'Note.md');
	});

	it('joins a folder path', () => {
		assert.equal(joinVaultPath('20 Evergreen', 'Note'), '20 Evergreen/Note.md');
	});

	it('tolerates leading and trailing slashes', () => {
		assert.equal(joinVaultPath('/20 Evergreen/', 'Note'), '20 Evergreen/Note.md');
	});

	it('supports nested folders', () => {
		assert.equal(joinVaultPath('a/b', 'Note'), 'a/b/Note.md');
	});
});

describe('coerceSettings', () => {
	it('falls back to the defaults for missing data', () => {
		assert.deepEqual(coerceSettings(null), DEFAULT_SETTINGS);
		assert.deepEqual(coerceSettings(undefined), DEFAULT_SETTINGS);
	});

	it('keeps valid stored values', () => {
		assert.deepEqual(coerceSettings({ displayMode: 'both', newNoteFolder: 'Notes' }), {
			displayMode: 'both',
			newNoteFolder: 'Notes',
		});
	});

	it('ignores an unknown display mode', () => {
		assert.equal(coerceSettings({ displayMode: 'nonsense' }).displayMode, 'embed');
	});

	it('ignores a non-string folder', () => {
		assert.equal(coerceSettings({ newNoteFolder: 42 }).newNoteFolder, '');
	});
});
