import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	anchorSuffix,
	buildReferenceLines,
	createPreview,
	stripMarkdown,
	unusableTargetReason,
} from '../src/reference.ts';

const ID = '20261016-164300-a7c9';
const block = { kind: 'block', id: ID } as const;
const heading = { kind: 'heading', text: 'Improving relationships' } as const;

describe('anchorSuffix', () => {
	it('uses the caret form for block references', () => {
		assert.equal(anchorSuffix(block), `#^${ID}`);
	});

	it('uses the plain heading form for section references', () => {
		assert.equal(anchorSuffix(heading), '#Improving relationships');
	});
});

describe('buildReferenceLines', () => {
	it('embeds the passage by default, duplicating no text', () => {
		assert.deepEqual(buildReferenceLines('2026.10.16', block, 'I keep noticing…', 'embed'), [
			`![[2026.10.16#^${ID}]]`,
		]);
	});

	it('renders a short clickable preview', () => {
		assert.deepEqual(buildReferenceLines('2026.10.16', block, 'I keep noticing…', 'link'), [
			`[[2026.10.16#^${ID}|I keep noticing…]]`,
		]);
	});

	it('renders a readable link followed by the embed', () => {
		assert.deepEqual(buildReferenceLines('2026.10.16', block, 'I keep noticing…', 'both'), [
			`[[2026.10.16#^${ID}|I keep noticing…]]`,
			`![[2026.10.16#^${ID}]]`,
		]);
	});

	it('supports section references in every mode', () => {
		assert.deepEqual(
			buildReferenceLines('Note', heading, 'Improving…', 'both'),
			['[[Note#Improving relationships|Improving…]]', '![[Note#Improving relationships]]'],
		);
	});
});

describe('stripMarkdown', () => {
	it('drops structural markers', () => {
		assert.equal(stripMarkdown('## Heading'), 'Heading');
		assert.equal(stripMarkdown('> quoted text'), 'quoted text');
		assert.equal(stripMarkdown('- bullet text'), 'bullet text');
		assert.equal(stripMarkdown('1. numbered text'), 'numbered text');
	});

	it('keeps the readable half of links', () => {
		assert.equal(stripMarkdown('see [[Some Note|that note]] now'), 'see that note now');
		assert.equal(stripMarkdown('see [[Some Note]] now'), 'see Some Note now');
		assert.equal(stripMarkdown('see [text](https://example.com) now'), 'see text now');
	});

	it('flattens multi-line passages into one line', () => {
		assert.equal(stripMarkdown('one\n\ntwo'), 'one two');
	});

	it('removes emphasis and inline code markers', () => {
		assert.equal(stripMarkdown('**bold** and *italic* and `code`'), 'bold and italic and code');
	});
});

describe('createPreview', () => {
	it('takes the first few words and marks the truncation', () => {
		const text = 'I keep noticing that I rush whenever I am tired and hungry.';
		assert.equal(createPreview(text), 'I keep noticing that I rush whenever I…');
	});

	it('leaves short passages alone', () => {
		assert.equal(createPreview('Short thought.'), 'Short thought.');
	});

	it('strips characters that would break a link alias', () => {
		const preview = createPreview('a | b [c] d');
		assert.equal(preview.includes('|'), false);
		assert.equal(preview.includes('['), false);
		assert.equal(preview.includes(']'), false);
	});

	it('never exceeds the character limit', () => {
		const preview = createPreview('supercalifragilisticexpialidocious '.repeat(20));
		assert.ok(preview.length <= 65, `preview was ${preview.length} chars`);
	});

	it('falls back to a sensible label for empty passages', () => {
		assert.equal(createPreview('   '), 'Reference');
		assert.equal(createPreview('###'), 'Reference');
	});

	it('reads prose, not markup, from a list item', () => {
		assert.equal(createPreview('- [ ] call mom about the thing'), 'call mom about the thing');
	});
});

describe('unusableTargetReason', () => {
	it('accepts ordinary note names', () => {
		assert.equal(unusableTargetReason('2026.10.16'), null);
		assert.equal(unusableTargetReason('Improving relationships'), null);
		assert.equal(unusableTargetReason('folder/Note'), null);
	});

	it('refuses names Obsidian cannot put inside a link', () => {
		assert.match(unusableTargetReason('weird#name') ?? '', /Rename the note/);
		assert.match(unusableTargetReason('weird|name') ?? '', /Rename the note/);
		assert.match(unusableTargetReason('weird[name]') ?? '', /Rename the note/);
	});
});
