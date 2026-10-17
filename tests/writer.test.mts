import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { anchorPattern, appendReferenceBlock, hasReference } from '../src/writer.ts';
import { applyLineEdits, hasBlankAfter } from '../src/line-edits.ts';

const ID = '20261016-164300-a7c9';
const block = { kind: 'block', id: ID } as const;
const heading = { kind: 'heading', text: 'Improving relationships' } as const;

describe('hasReference', () => {
	it('finds an embed of the same block', () => {
		assert.equal(hasReference(`![[2026.10.16#^${ID}]]`, block), true);
	});

	it('finds a short link with an alias', () => {
		assert.equal(hasReference(`[[2026.10.16#^${ID}|I keep noticing…]]`, block), true);
	});

	it('finds the reference inside a longer note', () => {
		const content = `# Notes\n\nSome prose.\n\n![[2026.10.16#^${ID}]]\n\nMore prose.`;
		assert.equal(hasReference(content, block), true);
	});

	it('does not match a different block', () => {
		assert.equal(hasReference('![[2026.10.16#^20250101-000000-zzzz]]', block), false);
	});

	it('does not match a bare mention of the id in prose', () => {
		assert.equal(hasReference(`The id ${ID} appears in text.`, block), false);
	});

	it('handles heading anchors', () => {
		assert.equal(hasReference('![[Note#Improving relationships]]', heading), true);
		assert.equal(hasReference('![[Note#Something else]]', heading), false);
	});

	it('does not treat a longer heading as a match', () => {
		assert.equal(hasReference('[[Note#Improving relationships today]]', heading), false);
	});

	it('escapes regex characters in heading text', () => {
		const odd = { kind: 'heading', text: 'Q&A (v2.1)' } as const;
		assert.equal(hasReference('[[Note#Q&A (v2.1)]]', odd), true);
		assert.equal(hasReference('[[Note#Q&A (v2X1)]]', odd), false);
	});
});

describe('anchorPattern', () => {
	it('only matches inside a link', () => {
		const pattern = anchorPattern(block);
		assert.equal(pattern.test(`[[a#^${ID}]]`), true);
		assert.equal(pattern.test(`plain ^${ID} text`), false);
	});
});

describe('appendReferenceBlock', () => {
	it('separates the reference from existing content with one blank line', () => {
		assert.equal(
			appendReferenceBlock('Some prose.', [`![[Note#^${ID}]]`]),
			`Some prose.\n\n![[Note#^${ID}]]\n`,
		);
	});

	it('collapses trailing blank lines rather than stacking them', () => {
		assert.equal(
			appendReferenceBlock('Some prose.\n\n\n', [`![[Note#^${ID}]]`]),
			`Some prose.\n\n![[Note#^${ID}]]\n`,
		);
	});

	it('writes just the reference into an empty note', () => {
		assert.equal(appendReferenceBlock('', [`![[Note#^${ID}]]`]), `![[Note#^${ID}]]\n`);
	});

	it('writes several references one per line', () => {
		assert.equal(
			appendReferenceBlock('', ['[[a#^x]]', '[[a#^y]]']),
			'[[a#^x]]\n[[a#^y]]\n',
		);
	});
});

describe('applyLineEdits', () => {
	it('applies bottom-up so earlier edits stay valid', () => {
		const lines = ['a', 'b', 'c', 'd'];
		const result = applyLineEdits(lines, [
			{ startLine: 0, endLine: 0, lines: ['A'] },
			{ startLine: 2, endLine: 3, lines: ['C', 'C2', 'C3'] },
		]);
		assert.deepEqual(result, ['A', 'b', 'C', 'C2', 'C3']);
	});

	it('refuses overlapping edits instead of corrupting the note', () => {
		assert.throws(
			() =>
				applyLineEdits(['a', 'b', 'c'], [
					{ startLine: 0, endLine: 2, lines: ['x'] },
					{ startLine: 1, endLine: 1, lines: ['y'] },
				]),
			/Overlapping edits/,
		);
	});

	it('leaves the input untouched', () => {
		const lines = ['a', 'b'];
		applyLineEdits(lines, [{ startLine: 0, endLine: 1, lines: ['z'] }]);
		assert.deepEqual(lines, ['a', 'b']);
	});
});

describe('hasBlankAfter', () => {
	it('is false at the end of the note, so a trailing newline is added', () => {
		assert.equal(hasBlankAfter(['a'], 0), false);
	});

	it('is true when the next line is already blank', () => {
		assert.equal(hasBlankAfter(['a', '', 'b'], 0), true);
	});

	it('is false when the next line has content', () => {
		assert.equal(hasBlankAfter(['a', 'b'], 0), false);
	});
});
