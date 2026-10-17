/**
 * End-to-end checks of the "one passage, several destination notes" workflow,
 * using only the pure parts of the plugin (no Obsidian instance required).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeSelection } from '../src/selection-plan.ts';
import type { Anchor } from '../src/selection-plan.ts';
import { buildReferenceLines, createPreview } from '../src/reference.ts';
import { appendReferenceBlock, missingReferences } from '../src/writer.ts';
import { applyPlan, constantId, select, selectLines, sequentialIds } from './helpers.mts';
import { DEFAULT_SETTINGS, type ReferenceDisplayMode } from '../src/types.ts';

interface Prepared {
	anchor: Anchor;
	lines: string[];
}

/** Mirrors what the plugin does for one destination note. */
function writeInto(content: string, prepared: Prepared[]): string {
	const missing = missingReferences(content, prepared);
	if (missing.length === 0) return content;
	return appendReferenceBlock(
		content,
		missing.flatMap((entry) => entry.lines),
	);
}

function prepareIn(
	unit: { anchor: Anchor; text: string },
	mode: ReferenceDisplayMode,
): Prepared {
	return {
		anchor: unit.anchor,
		lines: buildReferenceLines('2026.10.16', unit.anchor, createPreview(unit.text), mode),
	};
}

/** The default display mode is "full embedded passage". */
function prepare(unit: { anchor: Anchor; text: string }): Prepared {
	return prepareIn(unit, DEFAULT_SETTINGS.displayMode);
}

const ID = '20261016-164300-a7c9';

describe('one passage, several destinations', () => {
	const doc = 'I noticed that I rush when I talk to my mom.\n\nAnother thought.';

	it('writes the same block reference into every destination', () => {
		const plan = analyzeSelection(doc, select(doc, 'I noticed that I rush when I talk to my mom.'), {
			makeId: constantId(ID),
		});
		assert.equal(plan.status, 'ready');
		if (plan.status !== 'ready') return;

		const prepared = plan.plan.units.map(prepare);
		let relationships = '# Improving relationships\n';
		let mom = '# Conversations with family\n';

		relationships = writeInto(relationships, prepared);
		mom = writeInto(mom, prepared);

		const expected = `![[2026.10.16#^${ID}]]`;
		assert.ok(relationships.includes(expected));
		assert.ok(mom.includes(expected));
	});

	it('never copies the passage text into the destination', () => {
		const plan = analyzeSelection(doc, select(doc, 'I noticed that I rush when I talk to my mom.'), {
			makeId: constantId(ID),
		});
		if (plan.status !== 'ready') throw new Error('expected a plan');

		const written = writeInto('', plan.plan.units.map(prepare));
		assert.equal(written, `![[2026.10.16#^${ID}]]\n`);
		assert.equal(written.includes('I rush'), false);
	});

	it('does not duplicate the reference when the operation is repeated', () => {
		const plan = analyzeSelection(doc, select(doc, 'I noticed that I rush when I talk to my mom.'), {
			makeId: constantId(ID),
		});
		if (plan.status !== 'ready') throw new Error('expected a plan');
		const prepared = plan.plan.units.map(prepare);

		const once = writeInto('Existing prose.\n', prepared);
		const twice = writeInto(once, prepared);
		const thrice = writeInto(twice, prepared);

		assert.equal(twice, once);
		assert.equal(thrice, once);
		assert.equal(once.match(/#\^/g)?.length, 1);
	});

	it('still adds the reference to a second destination that lacks it', () => {
		const plan = analyzeSelection(doc, select(doc, 'I noticed that I rush when I talk to my mom.'), {
			makeId: constantId(ID),
		});
		if (plan.status !== 'ready') throw new Error('expected a plan');
		const prepared = plan.plan.units.map(prepare);

		const first = writeInto('', prepared);
		const second = writeInto('', prepared);
		assert.equal(first, second);
		assert.equal(writeInto(first, prepared), first);
	});

	it('references each paragraph of a multi-paragraph passage exactly once', () => {
		const plan = analyzeSelection(doc, selectLines(doc, 0, 2), {
			makeId: sequentialIds(),
		});
		if (plan.status !== 'ready') throw new Error('expected a plan');
		assert.equal(plan.plan.units.length, 2);

		const prepared = plan.plan.units.map(prepare);
		const written = writeInto('# Destination\n', prepared);
		assert.equal(written.match(/#\^/g)?.length, 2);
		assert.equal(writeInto(written, prepared), written);
	});
});

describe('the three display settings', () => {
	const anchor: Anchor = { kind: 'block', id: ID };

	it('full embed writes only the embed', () => {
		const lines = buildReferenceLines('Source', anchor, 'I noticed that…', 'embed');
		assert.deepEqual(lines, [`![[Source#^${ID}]]`]);
	});

	it('short link writes only a readable link', () => {
		const lines = buildReferenceLines('Source', anchor, 'I noticed that…', 'link');
		assert.deepEqual(lines, [`[[Source#^${ID}|I noticed that…]]`]);
	});

	it('both writes a readable link followed by the embed', () => {
		const lines = buildReferenceLines('Source', anchor, 'I noticed that…', 'both');
		assert.deepEqual(lines, [
			`[[Source#^${ID}|I noticed that…]]`,
			`![[Source#^${ID}]]`,
		]);
	});

	it('all three modes point at the same block reference', () => {
		for (const mode of ['embed', 'link', 'both'] as ReferenceDisplayMode[]) {
			const lines = buildReferenceLines('Source', anchor, 'preview', mode);
			assert.ok(lines.every((line) => line.includes(`Source#^${ID}`)), mode);
		}
	});

	it('every mode is idempotent when the operation is repeated', () => {
		for (const mode of ['embed', 'link', 'both'] as ReferenceDisplayMode[]) {
			const prepared: Prepared[] = [prepareIn({ anchor, text: 'I noticed that I rush.' }, mode)];
			const once = writeInto('', prepared);
			assert.equal(writeInto(once, prepared), once, mode);
		}
	});
});

describe('edits to the original passage', () => {
	it('are picked up by the embed, because no text is copied', () => {
		const doc = 'I rush when I talk to my mom.';
		const plan = analyzeSelection(doc, select(doc, 'I rush when I talk to my mom.'), {
			makeId: constantId(ID),
		});
		if (plan.status !== 'ready') throw new Error('expected a plan');

		const edited = applyPlan(doc, plan.plan).replace('I rush', 'I still rush');
		const destination = writeInto('', plan.plan.units.map(prepare));

		// The destination holds only a pointer, so it cannot go stale.
		assert.equal(destination.includes('rush'), false);
		assert.ok(edited.includes(`^${ID}`), 'the block ID survives an edit to the text');
	});
});
