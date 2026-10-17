import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReferenceSite } from '../src/block-rename.ts';
import {
	blockIdFromAnchor,
	findBlockIdAt,
	findBlockIdDefinitions,
	hasBlockIdDefinition,
	isValidBlockIdCandidate,
	parseWikiLink,
	renameBlockIdDefinition,
	rewriteLinkAnchors,
	sanitizeBlockIdInput,
} from '../src/block-rename.ts';

const OLD = '20261016-164300-a7c9';

describe('parseWikiLink', () => {
	it('reads a plain block reference', () => {
		assert.deepEqual(parseWikiLink(`[[2026.10.16#^${OLD}]]`), {
			embedded: false,
			target: '2026.10.16',
			anchor: `^${OLD}`,
			alias: null,
		});
	});

	it('reads an embed', () => {
		assert.equal(parseWikiLink(`![[Note#^${OLD}]]`)?.embedded, true);
	});

	it('separates the alias', () => {
		const parsed = parseWikiLink(`[[Note#^${OLD}|I keep noticing…]]`);
		assert.equal(parsed?.alias, 'I keep noticing…');
		assert.equal(parsed?.anchor, `^${OLD}`);
		assert.equal(parsed?.target, 'Note');
	});

	it('handles a link to a block in the same note', () => {
		const parsed = parseWikiLink(`[[#^${OLD}]]`);
		assert.equal(parsed?.target, '');
		assert.equal(parsed?.anchor, `^${OLD}`);
	});

	it('handles a heading anchor', () => {
		assert.equal(parseWikiLink('[[Note#Improving relationships]]')?.anchor, 'Improving relationships');
	});

	it('handles a path with folders', () => {
		assert.equal(parseWikiLink(`[[20 Evergreen/Note#^${OLD}]]`)?.target, '20 Evergreen/Note');
	});

	it('rejects anything that is not a wiki link', () => {
		assert.equal(parseWikiLink('just prose'), null);
		assert.equal(parseWikiLink('[markdown](link.md)'), null);
	});
});

describe('blockIdFromAnchor', () => {
	it('unwraps a block anchor', () => {
		assert.equal(blockIdFromAnchor(`^${OLD}`), OLD);
	});

	it('ignores heading anchors', () => {
		assert.equal(blockIdFromAnchor('Some heading'), null);
	});

	it('ignores an empty anchor', () => {
		assert.equal(blockIdFromAnchor('^'), null);
	});
});

describe('block ID validation', () => {
	it('accepts letters, numbers and hyphens', () => {
		assert.equal(isValidBlockIdCandidate('mom-rush'), true);
		assert.equal(isValidBlockIdCandidate(OLD), true);
	});

	it('rejects anything Obsidian would not resolve', () => {
		assert.equal(isValidBlockIdCandidate(''), false);
		assert.equal(isValidBlockIdCandidate('has space'), false);
		assert.equal(isValidBlockIdCandidate('has_underscore'), false);
		assert.equal(isValidBlockIdCandidate('a'.repeat(65)), false);
	});

	it('tidies typed input into something usable', () => {
		assert.equal(sanitizeBlockIdInput('  mom rush  '), 'mom-rush');
		assert.equal(sanitizeBlockIdInput('mom_rush!'), 'momrush');
		assert.equal(sanitizeBlockIdInput('Mom-Rush'), 'Mom-Rush');
	});
});

describe('findBlockIdDefinitions', () => {
	it('finds an ID at the end of a paragraph', () => {
		assert.deepEqual(findBlockIdDefinitions([`A thought. ^${OLD}`]), [
			{ line: 0, id: OLD, standalone: false },
		]);
	});

	it('finds an ID on its own line', () => {
		assert.deepEqual(findBlockIdDefinitions(['- a', '- b', '', `^${OLD}`]), [
			{ line: 3, id: OLD, standalone: true },
		]);
	});

	it('does not mistake a link for a definition', () => {
		assert.deepEqual(findBlockIdDefinitions([`![[Note#^${OLD}]]`]), []);
	});
});

describe('findBlockIdAt', () => {
	const doc = [
		'First thought.',
		'',
		`Second thought. ^${OLD}`,
		'',
		'- a',
		'- b',
		'',
		'^20260101-000000-zzzz',
		'',
		'No id here.',
	];

	it('finds the ID from anywhere inside the block', () => {
		assert.equal(findBlockIdAt(doc, 2)?.id, OLD);
	});

	it('finds a standalone ID when the cursor is on the line above it', () => {
		assert.equal(findBlockIdAt(doc, 5)?.id, '20260101-000000-zzzz');
	});

	it('finds a standalone ID when the cursor is on the ID line itself', () => {
		assert.equal(findBlockIdAt(doc, 7)?.id, '20260101-000000-zzzz');
	});

	it('returns null for a block with no ID', () => {
		assert.equal(findBlockIdAt(doc, 0), null);
		assert.equal(findBlockIdAt(doc, 9), null);
	});

	it('does not steal a standalone ID separated by a paragraph', () => {
		const separated = ['- a', '', 'unrelated paragraph', '', `^${OLD}`];
		assert.equal(findBlockIdAt(separated, 0), null);
	});
});

describe('hasBlockIdDefinition', () => {
	it('detects a collision inside the same note', () => {
		assert.equal(hasBlockIdDefinition([`A. ^${OLD}`], OLD), true);
		assert.equal(hasBlockIdDefinition(['A.'], OLD), false);
	});
});

describe('renameBlockIdDefinition', () => {
	it('renames an inline ID', () => {
		const result = renameBlockIdDefinition([`A thought. ^${OLD}`], OLD, 'mom-rush');
		assert.deepEqual(result.lines, ['A thought. ^mom-rush']);
		assert.equal(result.replaced, 1);
	});

	it('renames a standalone ID and leaves the surrounding lines alone', () => {
		const result = renameBlockIdDefinition(['- a', '- b', '', `^${OLD}`, '', 'after'], OLD, 'the-list');
		assert.deepEqual(result.lines, ['- a', '- b', '', '^the-list', '', 'after']);
		assert.equal(result.replaced, 1);
	});

	it('leaves links untouched, since those have no #', () => {
		const result = renameBlockIdDefinition([`![[Note#^${OLD}]]`], OLD, 'mom-rush');
		assert.deepEqual(result.lines, [`![[Note#^${OLD}]]`]);
		assert.equal(result.replaced, 0);
	});

	it('leaves other IDs alone', () => {
		const result = renameBlockIdDefinition(['A. ^20260101-000000-zzzz'], OLD, 'mom-rush');
		assert.equal(result.replaced, 0);
	});
});

describe('rewriteLinkAnchors', () => {
	it('rewrites the anchor inside a link', () => {
		const lines = [`![[2026.10.16#^${OLD}]]`];
		const result = rewriteLinkAnchors(lines, [{ line: 0, col: 0 }], OLD, 'mom-rush');
		assert.deepEqual(result.lines, ['![[2026.10.16#^mom-rush]]']);
		assert.equal(result.replaced, 1);
	});

	it('keeps the alias intact', () => {
		const lines = [`[[Note#^${OLD}|I keep noticing…]]`];
		const result = rewriteLinkAnchors(lines, [{ line: 0, col: 0 }], OLD, 'mom-rush');
		assert.deepEqual(result.lines, ['[[Note#^mom-rush|I keep noticing…]]']);
	});

	it('handles a longer replacement without drifting', () => {
		const lines = [`x ![[A#^old]] y ![[A#^old]]`];
		const result = rewriteLinkAnchors(
			lines,
			[
				{ line: 0, col: 2 },
				{ line: 0, col: 16 },
			],
			'old',
			'much-longer-id',
		);
		assert.deepEqual(result.lines, ['x ![[A#^much-longer-id]] y ![[A#^much-longer-id]]']);
		assert.equal(result.replaced, 2);
	});

	it('handles a shorter replacement without drifting', () => {
		const lines = [`x ![[A#^a-very-long-id]] y ![[A#^a-very-long-id]]`];
		const result = rewriteLinkAnchors(
			lines,
			[
				{ line: 0, col: 2 },
				{ line: 0, col: 29 },
			],
			'a-very-long-id',
			'x',
		);
		assert.deepEqual(result.lines, ['x ![[A#^x]] y ![[A#^x]]']);
	});

	it('rewrites several lines', () => {
		const lines = [`[[A#^${OLD}]]`, 'unrelated', `![[B#^${OLD}]]`];
		const result = rewriteLinkAnchors(
			lines,
			[
				{ line: 0, col: 0 },
				{ line: 2, col: 0 },
			],
			OLD,
			'mom-rush',
		);
		assert.deepEqual(result.lines, ['[[A#^mom-rush]]', 'unrelated', '![[B#^mom-rush]]']);
	});

	it('leaves a line alone when the anchor is not there', () => {
		const result = rewriteLinkAnchors(['![[Note#^different]]'], [{ line: 0, col: 0 }], OLD, 'x');
		assert.equal(result.replaced, 0);
	});

	it('ignores a site pointing past the end of the note', () => {
		const result = rewriteLinkAnchors(['one line'], [{ line: 9, col: 0 }], OLD, 'x');
		assert.equal(result.replaced, 0);
	});

	it('leaves the input untouched', () => {
		const lines = [`![[Note#^${OLD}]]`];
		rewriteLinkAnchors(lines, [{ line: 0, col: 0 }], OLD, 'mom-rush');
		assert.deepEqual(lines, [`![[Note#^${OLD}]]`]);
	});
});

describe('renaming across notes', () => {
	/** Locate the `[[` / `![[` of every link on a line that points at `id`. */
	function sitesIn(lines: string[], id: string): ReferenceSite[] {
		const sites: ReferenceSite[] = [];
		lines.forEach((line, index) => {
			let from = 0;
			for (;;) {
				const at = line.indexOf('[[', from);
				if (at === -1) break;
				const start = at > 0 && line[at - 1] === '!' ? at - 1 : at;
				if (line.slice(start).includes(`#^${id}`)) sites.push({ line: index, col: start });
				from = at + 2;
			}
		});
		return sites;
	}

	it('updates the definition and every reference, keeping aliases', () => {
		const source = ['A thought worth keeping.', '', `![[Other#^${OLD}]]`, '', `^${OLD}`];
		const relationships = [`# Relationships`, '', `![[2026.10.16#^${OLD}]]`];
		const family = [`[[2026.10.16#^${OLD}|I keep noticing…]]`];

		const renamed = renameBlockIdDefinition(source, OLD, 'mom-rush').lines;
		const updated = rewriteLinkAnchors(renamed, sitesIn(renamed, OLD), OLD, 'mom-rush').lines;
		const a = rewriteLinkAnchors(relationships, sitesIn(relationships, OLD), OLD, 'mom-rush').lines;
		const b = rewriteLinkAnchors(family, sitesIn(family, OLD), OLD, 'mom-rush').lines;

		assert.deepEqual(updated, ['A thought worth keeping.', '', '![[Other#^mom-rush]]', '', '^mom-rush']);
		assert.deepEqual(a, ['# Relationships', '', '![[2026.10.16#^mom-rush]]']);
		assert.deepEqual(b, ['[[2026.10.16#^mom-rush|I keep noticing…]]']);
	});

	it('leaves links to a different note alone, even with the same ID', () => {
		const other = [`![[Somewhere Else#^${OLD}]]`];
		const result = rewriteLinkAnchors(other, [], OLD, 'mom-rush');
		assert.deepEqual(result.lines, other);
	});

	it('does not touch prose that merely mentions the old ID', () => {
		const lines = [`The id ${OLD} was mentioned in passing.`];
		const result = rewriteLinkAnchors(lines, [], OLD, 'mom-rush');
		assert.deepEqual(result.lines, lines);
	});

	it('is a no-op when nothing references the block', () => {
		const lines = ['Nothing to see.'];
		assert.equal(rewriteLinkAnchors(lines, [], OLD, 'x').replaced, 0);
	});
});
