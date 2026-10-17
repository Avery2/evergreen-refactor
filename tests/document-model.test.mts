import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	buildBlocks,
	classifyLines,
	collectListItems,
	contentEndColumn,
	contentStartColumn,
	findBlockAt,
	headingSectionBody,
	isUniqueHeading,
} from '../src/document-model.ts';

const kinds = (doc: string): string[] => classifyLines(doc.split('\n')).map((line) => line.kind);

const blocks = (doc: string) =>
	buildBlocks(classifyLines(doc.split('\n'))).map((block) => ({
		kind: block.kind,
		start: block.startLine,
		end: block.endLine,
	}));

describe('classifyLines', () => {
	it('separates blank lines from content', () => {
		assert.deepEqual(kinds('one\n\ntwo'), ['text', 'blank', 'text']);
	});

	it('recognises headings, quotes, tables and list items', () => {
		assert.deepEqual(kinds('# Title'), ['heading']);
		assert.deepEqual(kinds('> quoted'), ['quote']);
		assert.deepEqual(kinds('| a | b |'), ['table']);
		assert.deepEqual(kinds('- item'), ['listItem']);
		assert.deepEqual(kinds('1. item'), ['listItem']);
	});

	it('prefers a horizontal rule over a list item', () => {
		assert.deepEqual(kinds('- - -'), ['hr']);
		assert.deepEqual(kinds('---'), ['hr']);
	});

	it('treats everything inside a fence as code, including lookalike lines', () => {
		const doc = ['```ts', '- not a list', '# not a heading', '```', 'after'].join('\n');
		assert.deepEqual(kinds(doc), ['fence', 'fence', 'fence', 'fence', 'text']);
	});

	it('handles tilde fences and an unterminated fence', () => {
		assert.deepEqual(kinds('~~~\n- x\n~~~'), ['fence', 'fence', 'fence']);
		assert.deepEqual(kinds('```\n- x'), ['fence', 'fence']);
	});
});

describe('buildBlocks', () => {
	it('treats consecutive lines as one paragraph', () => {
		assert.deepEqual(blocks('line one\nline two'), [{ kind: 'paragraph', start: 0, end: 1 }]);
	});

	it('splits paragraphs on blank lines', () => {
		assert.deepEqual(blocks('one\n\ntwo'), [
			{ kind: 'paragraph', start: 0, end: 0 },
			{ kind: 'paragraph', start: 2, end: 2 },
		]);
	});

	it('keeps a fenced code block whole', () => {
		assert.deepEqual(blocks('intro\n\n```\ncode\n```\n\nafter'), [
			{ kind: 'paragraph', start: 0, end: 0 },
			{ kind: 'code', start: 2, end: 4 },
			{ kind: 'paragraph', start: 6, end: 6 },
		]);
	});

	it('groups a contiguous list into one block', () => {
		assert.deepEqual(blocks('- a\n- b\n- c'), [{ kind: 'list', start: 0, end: 2 }]);
	});

	it('ends a list at a blank line', () => {
		assert.deepEqual(blocks('- a\n\ntext'), [
			{ kind: 'list', start: 0, end: 0 },
			{ kind: 'paragraph', start: 2, end: 2 },
		]);
	});

	it('treats a table as one block', () => {
		assert.deepEqual(blocks('| a |\n| - |\n| b |'), [{ kind: 'table', start: 0, end: 2 }]);
	});
});

describe('collectListItems', () => {
	it('gives each top-level bullet its own item', () => {
		const lines = classifyLines('- a\n- b\n- c'.split('\n'));
		assert.deepEqual(collectListItems(lines, 0, 2), [
			{ startLine: 0, endLine: 0, indent: 0 },
			{ startLine: 1, endLine: 1, indent: 0 },
			{ startLine: 2, endLine: 2, indent: 0 },
		]);
	});

	it('includes nested children in the parent item', () => {
		const lines = classifyLines('- a\n  - b\n  - c\n- d'.split('\n'));
		assert.deepEqual(collectListItems(lines, 0, 3), [
			{ startLine: 0, endLine: 2, indent: 0 },
			{ startLine: 1, endLine: 1, indent: 2 },
			{ startLine: 2, endLine: 2, indent: 2 },
			{ startLine: 3, endLine: 3, indent: 0 },
		]);
	});

	it('includes continuation lines in the item', () => {
		const lines = classifyLines('- a\n  continued\n- b'.split('\n'));
		assert.deepEqual(collectListItems(lines, 0, 2), [
			{ startLine: 0, endLine: 1, indent: 0 },
			{ startLine: 2, endLine: 2, indent: 0 },
		]);
	});
});

describe('contentStartColumn', () => {
	it('skips the bullet so selecting the text still counts as the whole item', () => {
		const lines = classifyLines('- buy milk'.split('\n'));
		assert.equal(contentStartColumn(lines[0]), 2);
	});

	it('is the indent for an ordinary paragraph', () => {
		const lines = classifyLines('  indented'.split('\n'));
		assert.equal(contentStartColumn(lines[0]), 2);
	});
});

describe('contentEndColumn', () => {
	it('ignores a block ID written at the end of the line', () => {
		const lines = classifyLines('A thought. ^20250101-000000-aaaa'.split('\n'));
		assert.equal(contentEndColumn(lines[0]), 10);
	});

	it('is the length of an ordinary line', () => {
		const lines = classifyLines('A thought.'.split('\n'));
		assert.equal(contentEndColumn(lines[0]), 10);
	});
});

describe('headingSectionBody', () => {
	it('runs to the next heading of the same or higher level', () => {
		const doc = ['# A', '', 'body one', '', '## B', '', 'body two'].join('\n');
		const lines = classifyLines(doc.split('\n'));
		const all = buildBlocks(lines);
		const heading = all.find((block) => block.headingText === 'B');
		assert.ok(heading);
		assert.deepEqual(headingSectionBody(lines, all, heading), { startLine: 6, endLine: 6 });
	});

	it('includes deeper headings in the section', () => {
		const doc = ['# A', '', 'body one', '', '## B', '', 'body two'].join('\n');
		const lines = classifyLines(doc.split('\n'));
		const all = buildBlocks(lines);
		const heading = all.find((block) => block.headingText === 'A');
		assert.ok(heading);
		assert.deepEqual(headingSectionBody(lines, all, heading), { startLine: 2, endLine: 6 });
	});

	it('returns null for an empty section', () => {
		const doc = ['# A', '', '# B', '', 'body'].join('\n');
		const lines = classifyLines(doc.split('\n'));
		const all = buildBlocks(lines);
		assert.equal(headingSectionBody(lines, all, all[0]), null);
	});
});

describe('isUniqueHeading', () => {
	it('accepts a heading that appears once', () => {
		const all = buildBlocks(classifyLines('# A\n\nbody'.split('\n')));
		assert.equal(isUniqueHeading(all, all[0]), true);
	});

	it('rejects a duplicated heading, because #A would be ambiguous', () => {
		const all = buildBlocks(classifyLines('# A\n\nx\n\n# A\n\ny'.split('\n')));
		assert.equal(isUniqueHeading(all, all[0]), false);
	});
});

describe('findBlockAt', () => {
	it('locates the block containing a line', () => {
		const all = buildBlocks(classifyLines('one\n\ntwo\nthree'.split('\n')));
		assert.equal(findBlockAt(all, 0)?.startLine, 0);
		assert.equal(findBlockAt(all, 3)?.startLine, 2);
	});

	it('reports no block for a blank separator line', () => {
		const all = buildBlocks(classifyLines('one\n\ntwo'.split('\n')));
		assert.equal(findBlockAt(all, 1), null);
	});
});
