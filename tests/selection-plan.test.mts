import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeSelection } from '../src/selection-plan.ts';
import { applyPlan, constantId, select, selectLines, sequentialIds } from './helpers.mts';

const ID = '20261016-164300-a7c9';

function ready(doc: string, selection: Parameters<typeof analyzeSelection>[1], makeId = constantId(ID)) {
	const result = analyzeSelection(doc, selection, { makeId });
	assert.equal(result.status, 'ready', `expected a plan, got: ${JSON.stringify(result)}`);
	if (result.status !== 'ready') throw new Error('unreachable');
	return result.plan;
}

function decision(doc: string, selection: Parameters<typeof analyzeSelection>[1]) {
	const result = analyzeSelection(doc, selection, { makeId: constantId(ID) });
	assert.equal(result.status, 'decision', `expected a decision, got: ${JSON.stringify(result)}`);
	if (result.status !== 'decision') throw new Error('unreachable');
	return result.request;
}

function resolve(
	doc: string,
	selection: Parameters<typeof analyzeSelection>[1],
	choice: 'widen' | 'split',
	makeId = constantId(ID),
) {
	const result = analyzeSelection(doc, selection, { makeId, decision: choice });
	assert.equal(result.status, 'ready', `expected a plan, got: ${JSON.stringify(result)}`);
	if (result.status !== 'ready') throw new Error('unreachable');
	return result.plan;
}

describe('a complete paragraph', () => {
	it('gets a timestamped block ID at the end of the line', () => {
		const doc = 'I keep noticing that I rush.\n\nSecond paragraph.';
		const plan = ready(doc, select(doc, 'I keep noticing that I rush.'));
		assert.equal(plan.kind, 'paragraph');
		assert.deepEqual(plan.units[0].anchor, { kind: 'block', id: ID });
		assert.equal(
			applyPlan(doc, plan),
			`I keep noticing that I rush. ^${ID}\n\nSecond paragraph.`,
		);
	});

	it('works for a paragraph that spans several lines', () => {
		const doc = 'One thought\nthat continues here.';
		const plan = ready(doc, selectLines(doc, 0, 1));
		assert.equal(applyPlan(doc, plan), `One thought\nthat continues here. ^${ID}`);
	});

	it('reuses an existing block ID instead of stacking a second one', () => {
		const doc = `I keep noticing that I rush. ^${ID}\n`;
		const plan = ready(doc, select(doc, 'I keep noticing that I rush.'));
		assert.equal(plan.units[0].reused, true);
		assert.deepEqual(plan.edits, []);
		assert.equal(applyPlan(doc, plan), doc);
	});

	it('still recognises a paragraph that already has a different ID', () => {
		const doc = 'A thought. ^20250101-000000-zzzz\n';
		const plan = ready(doc, select(doc, 'A thought.'));
		assert.equal(plan.units[0].reused, true);
		assert.deepEqual(plan.units[0].anchor, { kind: 'block', id: '20250101-000000-zzzz' });
	});
});

describe('part of a paragraph', () => {
	const doc = 'I keep noticing that I rush when I am tired.';

	it('asks rather than guessing', () => {
		const request = decision(doc, select(doc, 'I rush'));
		assert.match(request.reason, /whole paragraphs/);
		assert.deepEqual(
			request.options.map((option) => option.id),
			['widen', 'split'],
		);
	});

	it('can widen to the whole paragraph', () => {
		const plan = resolve(doc, select(doc, 'I rush'), 'widen');
		assert.equal(plan.kind, 'paragraph');
		assert.equal(applyPlan(doc, plan), `${doc} ^${ID}`);
	});

	it('can split the paragraph so the selection stands alone', () => {
		const plan = resolve(doc, select(doc, 'I rush'), 'split');
		assert.equal(
			applyPlan(doc, plan),
			`I keep noticing that\n\nI rush ^${ID}\n\nwhen I am tired.`,
		);
		assert.equal(plan.units[0].text, 'I rush');
	});

	it('splits at the start of a paragraph without leaving an empty line', () => {
		const plan = resolve(doc, select(doc, 'I keep noticing'), 'split');
		assert.equal(applyPlan(doc, plan), `I keep noticing ^${ID}\n\nthat I rush when I am tired.`);
	});

	it('splits at the end of a paragraph without leaving an empty line', () => {
		const plan = resolve(doc, select(doc, 'when I am tired.'), 'split');
		assert.equal(applyPlan(doc, plan), `I keep noticing that I rush\n\nwhen I am tired. ^${ID}`);
	});

	it('never loses a word when splitting', () => {
		const plan = resolve(doc, select(doc, 'I rush'), 'split');
		const words = applyPlan(doc, plan)
			.replace(/\^[0-9a-z-]+/g, '')
			.split(/\s+/)
			.filter((word) => word.length > 0);
		assert.deepEqual(words, doc.split(/\s+/));
	});
});

describe('several paragraphs', () => {
	it('creates one reference per paragraph so nothing is widened', () => {
		const doc = 'First thought.\n\nSecond thought.\n\nThird.';
		const plan = ready(doc, selectLines(doc, 0, 2), sequentialIds());
		assert.equal(plan.kind, 'multi-unit');
		assert.equal(plan.units.length, 2);
		assert.equal(
			applyPlan(doc, plan),
			'First thought. ^20261016-164300-a001\n\nSecond thought. ^20261016-164300-a002\n\nThird.',
		);
	});

	it('gives each unit its own preview text', () => {
		const doc = 'First thought.\n\nSecond thought.';
		const plan = ready(doc, selectLines(doc, 0, 2), sequentialIds());
		assert.deepEqual(
			plan.units.map((unit) => unit.text),
			['First thought.', 'Second thought.'],
		);
	});

	it('reuses IDs that are already there', () => {
		const doc = `First. ^20250101-000000-aaaa\n\nSecond. ^20250101-000000-bbbb`;
		const plan = ready(doc, selectLines(doc, 0, 2), sequentialIds());
		assert.deepEqual(plan.edits, []);
		assert.deepEqual(
			plan.units.map((unit) => unit.anchor),
			[
				{ kind: 'block', id: '20250101-000000-aaaa' },
				{ kind: 'block', id: '20250101-000000-bbbb' },
			],
		);
	});
});

describe('a whole heading section', () => {
	const doc = [
		'# Improving relationships',
		'',
		'I rush.',
		'',
		'I interrupt.',
		'',
		'# Something else',
		'',
		'Unrelated.',
	].join('\n');

	it('uses a section reference and changes nothing in the source note', () => {
		const plan = ready(doc, selectLines(doc, 2, 4));
		assert.equal(plan.kind, 'heading-section');
		assert.deepEqual(plan.units[0].anchor, {
			kind: 'heading',
			text: 'Improving relationships',
		});
		assert.deepEqual(plan.edits, []);
		assert.equal(applyPlan(doc, plan), doc);
	});

	it('also works when the heading itself is selected', () => {
		const plan = ready(doc, selectLines(doc, 0, 4));
		assert.equal(plan.kind, 'heading-section');
		assert.deepEqual(plan.edits, []);
	});

	it('falls back to block IDs when the selection only covers part of the section', () => {
		const plan = ready(doc, selectLines(doc, 2, 2), sequentialIds());
		assert.equal(plan.kind, 'paragraph');
	});

	it('refuses a duplicated heading and uses block IDs instead', () => {
		const duped = ['# Notes', '', 'One.', '', '# Notes', '', 'Two.'].join('\n');
		const plan = ready(duped, selectLines(duped, 2, 2), sequentialIds());
		assert.equal(plan.kind, 'paragraph');
	});
});

describe('lists', () => {
	it('puts the block ID on its own line for a whole list, with a blank line before it', () => {
		const doc = '- buy milk\n- call mom\n\nNext.';
		const plan = ready(doc, selectLines(doc, 0, 1));
		assert.equal(plan.kind, 'whole-block');
		assert.equal(
			applyPlan(doc, plan),
			`- buy milk\n- call mom\n\n^${ID}\n\nNext.`,
		);
	});

	it('appends the ID inline when the selection is a single list item', () => {
		const doc = '- a\n- b\n- c';
		const plan = ready(doc, selectLines(doc, 1, 1));
		assert.equal(plan.kind, 'list-item');
		assert.equal(applyPlan(doc, plan), `- a\n- b ^${ID}\n- c`);
	});

	it('treats selecting the text after the bullet as the whole item', () => {
		const doc = '- buy milk\n- other';
		const plan = ready(doc, select(doc, 'buy milk'));
		assert.equal(plan.kind, 'list-item');
		assert.equal(applyPlan(doc, plan), `- buy milk ^${ID}\n- other`);
	});

	it('keeps nested children with the parent item', () => {
		const doc = '- parent\n  - child one\n  - child two\n- sibling';
		const plan = ready(doc, selectLines(doc, 0, 2));
		assert.equal(plan.kind, 'list-item');
		assert.equal(plan.units[0].text, '- parent\n  - child one\n  - child two');
		assert.equal(
			applyPlan(doc, plan),
			`- parent\n  - child one\n  - child two ^${ID}\n- sibling`,
		);
	});

	it('asks before touching a list when only part of an item is selected', () => {
		const doc = '- buy milk and bread\n- other';
		const request = decision(doc, select(doc, 'milk and'));
		assert.match(request.reason, /list item or a whole list/);
		assert.deepEqual(
			request.options.map((option) => option.id),
			['widen'],
			'a list must never be split',
		);
	});

	it('widens a partial item selection to that item, not the whole list', () => {
		const doc = '- buy milk and bread\n- other';
		const plan = resolve(doc, select(doc, 'milk and'), 'widen');
		assert.equal(plan.kind, 'list-item');
		assert.equal(applyPlan(doc, plan), `- buy milk and bread ^${ID}\n- other`);
	});

	it('widens a selection spanning two items to the whole list', () => {
		const doc = '- one\n- two\n- three';
		const selection = { from: { line: 0, ch: 4 }, to: { line: 1, ch: 2 } };
		const plan = resolve(doc, selection, 'widen');
		assert.equal(plan.kind, 'whole-block');
		assert.equal(applyPlan(doc, plan), `- one\n- two\n- three\n\n^${ID}\n`);
	});

	it('adds a trailing blank line when the list ends the note', () => {
		const doc = '- a\n- b';
		const plan = ready(doc, selectLines(doc, 0, 1));
		assert.equal(applyPlan(doc, plan), `- a\n- b\n\n^${ID}\n`);
	});
});

describe('blockquotes, tables and code', () => {
	it('references a whole blockquote from its own line', () => {
		const doc = '> one\n> two\n\nafter';
		const plan = ready(doc, selectLines(doc, 0, 1));
		assert.equal(applyPlan(doc, plan), `> one\n> two\n\n^${ID}\n\nafter`);
	});

	it('references a whole table from its own line', () => {
		const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n\nafter';
		const plan = ready(doc, selectLines(doc, 0, 2));
		assert.equal(plan.kind, 'whole-block');
		assert.equal(applyPlan(doc, plan), `| a | b |\n| - | - |\n| 1 | 2 |\n\n^${ID}\n\nafter`);
	});

	it('references a fenced code block from below the closing fence', () => {
		const doc = 'Intro.\n\n```ts\nconst x = 1;\n```\n\nOutro.';
		const plan = ready(doc, selectLines(doc, 2, 4));
		assert.equal(
			applyPlan(doc, plan),
			`Intro.\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n^${ID}\n\nOutro.`,
		);
	});

	it('explains that part of a code block cannot be referenced', () => {
		const doc = '```ts\nconst x = 1;\n```';
		const request = decision(doc, select(doc, 'const x = 1;'));
		assert.match(request.reason, /code block/);
		assert.deepEqual(
			request.options.map((option) => option.id),
			['widen'],
			'code must never be split',
		);
	});

	it('widening inside a code block references the whole fence', () => {
		const doc = '```ts\nconst x = 1;\n```';
		const plan = resolve(doc, select(doc, 'const x = 1;'), 'widen');
		assert.equal(applyPlan(doc, plan), `\`\`\`ts\nconst x = 1;\n\`\`\`\n\n^${ID}\n`);
	});
});

describe('selections that cannot be referenced', () => {
	it('reports an empty selection', () => {
		const result = analyzeSelection('text', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, {
			makeId: constantId(ID),
		});
		assert.equal(result.status, 'unsupported');
	});

	it('reports a selection of only whitespace', () => {
		const doc = 'one\n\n   \n\ntwo';
		const result = analyzeSelection(doc, selectLines(doc, 2, 2), { makeId: constantId(ID) });
		assert.equal(result.status, 'unsupported');
	});

	it('reports a horizontal rule', () => {
		const doc = 'a\n\n---\n\nb';
		const result = analyzeSelection(doc, selectLines(doc, 2, 2), { makeId: constantId(ID) });
		assert.equal(result.status, 'unsupported');
		if (result.status === 'unsupported') assert.match(result.reason, /horizontal rule/);
	});

	it('reports an empty note', () => {
		const result = analyzeSelection('', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, {
			makeId: constantId(ID),
		});
		assert.equal(result.status, 'unsupported');
	});

	it('skips a horizontal rule inside a multi-block selection but keeps the rest', () => {
		const doc = 'one\n\n---\n\ntwo';
		const plan = ready(doc, selectLines(doc, 0, 4), sequentialIds());
		assert.equal(plan.units.length, 2);
		assert.equal(plan.warnings.length, 1);
		assert.match(plan.warnings[0], /horizontal rule/);
	});

	it('skips a heading inside a multi-block selection with an explanation', () => {
		const doc = '## Notes\n\none\n\n## Other\n\ntwo';
		const plan = ready(doc, selectLines(doc, 0, 6), sequentialIds());
		assert.equal(plan.units.length, 2);
		assert.ok(plan.warnings.some((warning) => /heading/.test(warning)));
	});
});

describe('uniqueness', () => {
	it('regenerates an ID that already exists in the note', () => {
		const doc = `already here ^${ID}\n\nnew paragraph.`;
		let calls = 0;
		const makeId = () => {
			calls += 1;
			return calls === 1 ? ID : '20261016-164300-b000';
		};
		const plan = ready(doc, selectLines(doc, 2, 2), makeId);
		assert.equal(calls, 2);
		assert.deepEqual(plan.units[0].anchor, { kind: 'block', id: '20261016-164300-b000' });
	});
});
