/**
 * Turns "this chunk of my mind dump is selected" into a concrete, minimal plan:
 * which Obsidian block reference(s) to create, what (if anything) to change in
 * the source note, and — when Obsidian cannot do what was asked — an honest
 * explanation plus the alternatives.
 *
 * The guiding rule is that the original note is canonical. The plugin is only
 * ever allowed to *mark* a passage as addressable, never to move, reword or
 * reinterpret it.
 */

import { isValidBlockId } from './block-id.ts';
import type { LineEdit } from './line-edits.ts';
import { hasBlankAfter } from './line-edits.ts';
import {
	type Block,
	type DocLine,
	buildBlocks,
	classifyLines,
	contentEndColumn,
	contentStartColumn,
	findBlockAt,
	findListItemAt,
	headingSectionBody,
	isUniqueHeading,
} from './document-model.ts';

export interface SourcePosition {
	line: number;
	ch: number;
}

export interface SelectionRange {
	from: SourcePosition;
	to: SourcePosition;
}

export type Anchor =
	| { kind: 'block'; id: string }
	| { kind: 'heading'; text: string };

export interface ReferenceUnit {
	anchor: Anchor;
	/** The exact passage this unit stands for, as it appears in the source. */
	text: string;
	startLine: number;
	endLine: number;
	/** True when a block ID already existed and was reused instead of created. */
	reused: boolean;
}

export type PlanKind =
	| 'paragraph'
	| 'list-item'
	| 'whole-block'
	| 'heading-section'
	| 'multi-unit';

export interface SelectionPlan {
	kind: PlanKind;
	units: ReferenceUnit[];
	edits: LineEdit[];
	/** One line describing what the plugin decided to do. */
	summary: string;
	/** Things the user should know about, including anything skipped. */
	warnings: string[];
}

export type DecisionOptionId = 'widen' | 'split';

export interface DecisionOption {
	id: DecisionOptionId;
	label: string;
	description: string;
}

export interface DecisionRequest {
	reason: string;
	options: DecisionOption[];
	/** The selection that needs a decision, so the caller can re-run analysis. */
	selection: SelectionRange;
}

export type Analysis =
	| { status: 'ready'; plan: SelectionPlan }
	| { status: 'decision'; request: DecisionRequest }
	| { status: 'unsupported'; reason: string };

export interface AnalyzeContext {
	/** Produces a fresh, document-unique block ID. */
	makeId: (doc: string) => string;
	/** Set when resolving a previous `decision` result. */
	decision?: DecisionOptionId;
}

const INLINE_ID_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
const STANDALONE_ID_RE = /^\s*\^([A-Za-z0-9-]+)\s*$/;

/* ------------------------------------------------------------------ */
/* Selection helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Shrink a raw editor selection to the meaningful text inside it: no leading or
 * trailing blank lines, no leading or trailing whitespace.
 */
export function trimSelection(
	lines: DocLine[],
	selection: SelectionRange,
): SelectionRange | null {
	let fromLine = selection.from.line;
	let fromCh = selection.from.ch;
	let toLine = selection.to.line;
	let toCh = selection.to.ch;

	if (fromLine > toLine || (fromLine === toLine && fromCh >= toCh)) return null;

	if (fromLine === toLine) {
		const text = lines[fromLine].text.slice(fromCh, toCh);
		const leading = text.length - text.trimStart().length;
		const trailing = text.length - text.trimEnd().length;
		const start = fromCh + leading;
		const end = toCh - trailing;
		if (start >= end) return null;
		return { from: { line: fromLine, ch: start }, to: { line: toLine, ch: end } };
	}

	while (fromLine < toLine) {
		if (lines[fromLine].text.slice(fromCh).trim() !== '') break;
		fromLine += 1;
		fromCh = 0;
	}

	while (toLine > fromLine) {
		if (lines[toLine].text.slice(0, toCh).trim() !== '') break;
		toLine -= 1;
		toCh = lines[toLine].text.length;
	}

	if (fromLine === toLine) {
		return trimSelection(lines, {
			from: { line: fromLine, ch: fromCh },
			to: { line: toLine, ch: toCh },
		});
	}

	const firstText = lines[fromLine].text.slice(fromCh);
	fromCh += firstText.length - firstText.trimStart().length;
	const lastText = lines[toLine].text.slice(0, toCh);
	toCh -= lastText.length - lastText.trimEnd().length;

	if (fromLine > toLine || (fromLine === toLine && fromCh >= toCh)) return null;
	return { from: { line: fromLine, ch: fromCh }, to: { line: toLine, ch: toCh } };
}

interface UnitBounds {
	startLine: number;
	endLine: number;
}

/**
 * The addressable unit containing `line`: the enclosing list item for a list,
 * otherwise the whole block.
 */
function unitBounds(blocks: Block[], line: number): UnitBounds | null {
	const block = findBlockAt(blocks, line);
	if (!block) return null;
	if (block.kind === 'list') {
		const item = findListItemAt(block, line);
		if (item) return { startLine: item.startLine, endLine: item.endLine };
	}
	return { startLine: block.startLine, endLine: block.endLine };
}

/**
 * Grow a partial selection to whole blocks. A selection inside a single list
 * item grows to that item (the useful granularity); anything else grows to the
 * full block, which is the smallest thing Obsidian can address.
 */
export function widenSelection(
	lines: DocLine[],
	blocks: Block[],
	selection: SelectionRange,
): SelectionRange {
	const startBlock = findBlockAt(blocks, selection.from.line);
	const endBlock = findBlockAt(blocks, selection.to.line);
	if (!startBlock || !endBlock) return selection;

	if (startBlock === endBlock && startBlock.kind === 'list') {
		const startItem = findListItemAt(startBlock, selection.from.line);
		const endItem = findListItemAt(startBlock, selection.to.line);
		if (startItem && endItem && startItem === endItem) {
			return {
				from: { line: startItem.startLine, ch: 0 },
				to: { line: startItem.endLine, ch: lines[startItem.endLine].text.length },
			};
		}
	}

	return {
		from: { line: startBlock.startLine, ch: 0 },
		to: { line: endBlock.endLine, ch: lines[endBlock.endLine].text.length },
	};
}

function coversBlockStart(lines: DocLine[], block: Block, at: SourcePosition): boolean {
	return at.line === block.startLine && at.ch <= contentStartColumn(lines[block.startLine]);
}

function coversBlockEnd(lines: DocLine[], block: Block, at: SourcePosition): boolean {
	return at.line === block.endLine && at.ch >= contentEndColumn(lines[block.endLine]);
}

function coversUnitStart(lines: DocLine[], unit: UnitBounds, at: SourcePosition): boolean {
	return at.line === unit.startLine && at.ch <= contentStartColumn(lines[unit.startLine]);
}

function coversUnitEnd(lines: DocLine[], unit: UnitBounds, at: SourcePosition): boolean {
	return at.line === unit.endLine && at.ch >= contentEndColumn(lines[unit.endLine]);
}

function textOf(lines: DocLine[], startLine: number, endLine: number): string {
	return lines
		.slice(startLine, endLine + 1)
		.map((line) => line.text)
		.join('\n');
}

/* ------------------------------------------------------------------ */
/* Existing identifiers                                                */
/* ------------------------------------------------------------------ */

function existingInlineId(line: DocLine): string | null {
	const match = INLINE_ID_RE.exec(line.text);
	return match && isValidBlockId(match[1]) ? match[1] : null;
}

function existingStandaloneId(lines: DocLine[], afterLine: number): string | null {
	let index = afterLine + 1;
	while (index < lines.length && lines[index].kind === 'blank') index += 1;
	if (index >= lines.length) return null;
	const match = STANDALONE_ID_RE.exec(lines[index].text);
	return match && isValidBlockId(match[1]) ? match[1] : null;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export function analyzeSelection(
	doc: string,
	selection: SelectionRange,
	ctx: AnalyzeContext,
): Analysis {
	const lines = classifyLines(doc.split('\n'));
	const blocks = buildBlocks(lines);
	if (blocks.length === 0) {
		return { status: 'unsupported', reason: 'This note is empty, so there is nothing to reference yet.' };
	}

	const trimmed = trimSelection(lines, selection);
	if (!trimmed) {
		return { status: 'unsupported', reason: 'Select the passage you want to reference first.' };
	}

	const effective =
		ctx.decision === 'widen' ? widenSelection(lines, blocks, trimmed) : trimmed;

	const startBlock = findBlockAt(blocks, effective.from.line);
	const endBlock = findBlockAt(blocks, effective.to.line);
	if (!startBlock || !endBlock) {
		return { status: 'unsupported', reason: 'The selection does not sit inside a block that Obsidian can address.' };
	}

	if (startBlock.kind === 'hr') {
		return {
			status: 'unsupported',
			reason:
				'A horizontal rule has no content, so it cannot be referenced. Select the text around it instead.',
		};
	}

	const coversWholeStart = coversBlockStart(lines, startBlock, effective.from);
	const coversWholeEnd = coversBlockEnd(lines, endBlock, effective.to);

	// Case 1: the selection is exactly one whole block.
	if (startBlock === endBlock && coversWholeStart && coversWholeEnd) {
		return planForWholeBlock(lines, startBlock, ctx, doc);
	}

	// Case 2: the selection is exactly one list item inside a longer list.
	if (startBlock === endBlock && startBlock.kind === 'list') {
		const startUnit = unitBounds(blocks, effective.from.line);
		const endUnit = unitBounds(blocks, effective.to.line);
		if (
			startUnit &&
			endUnit &&
			startUnit.startLine === endUnit.startLine &&
			startUnit.endLine === endUnit.endLine &&
			coversUnitStart(lines, startUnit, effective.from) &&
			coversUnitEnd(lines, endUnit, effective.to)
		) {
			return planForListItem(lines, startBlock, startUnit, ctx, doc);
		}
	}

	// Case 3: the selection spans several whole blocks.
	if (startBlock !== endBlock && coversWholeStart && coversWholeEnd) {
		const section = matchHeadingSection(lines, blocks, startBlock, endBlock);
		if (section) return planForHeadingSection(lines, section, 'Selection matches a whole heading section.');

		const between = blocks.filter(
			(block) => block.startLine >= startBlock.startLine && block.endLine <= endBlock.endLine,
		);
		return planForBlocks(lines, between, ctx, doc);
	}

	// Otherwise part of a block is selected, which Obsidian cannot address.
	if (ctx.decision === 'split') {
		const split = planForSplitParagraph(lines, blocks, trimmed, ctx, doc);
		if (split) return split;
	}

	return decisionFor(blocks, trimmed, effective, startBlock);
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

function uniqueId(ctx: AnalyzeContext, doc: string): string {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const id = ctx.makeId(doc);
		if (!doc.includes(`^${id}`)) return id;
	}
	// Astronomically unlikely; the timestamp still makes it usable.
	return ctx.makeId(doc);
}

function inlineIdEdit(lines: DocLine[], line: number, id: string): LineEdit {
	return {
		startLine: line,
		endLine: line,
		lines: [`${lines[line].text.replace(/\s+$/, '')} ^${id}`],
	};
}

/**
 * Structured blocks (lists, quotes, tables, code fences) need their block ID on
 * a line of its own, surrounded by blank lines. For a whole list the blank line
 * before the ID is what makes it bind to the list rather than to the last item.
 */
function standaloneIdEdit(lines: DocLine[], block: Block, id: string): LineEdit {
	const replacement = [
		...lines.slice(block.startLine, block.endLine + 1).map((line) => line.text),
		'',
		`^${id}`,
	];
	if (!hasBlankAfter(lines.map((line) => line.text), block.endLine)) {
		replacement.push('');
	}
	return { startLine: block.startLine, endLine: block.endLine, lines: replacement };
}

function planForWholeBlock(
	lines: DocLine[],
	block: Block,
	ctx: AnalyzeContext,
	doc: string,
): Analysis {
	if (block.kind === 'heading') {
		return planForHeadingSection(lines, block, 'Selection is a heading.');
	}

	if (block.kind === 'list' && block.items.length === 1) {
		return planForListItem(lines, block, block.items[0], ctx, doc);
	}

	if (block.kind === 'paragraph') {
		const existing = existingInlineId(lines[block.endLine]);
		if (existing) {
			return ready('paragraph', [
				{
					anchor: { kind: 'block', id: existing },
					text: textOf(lines, block.startLine, block.endLine),
					startLine: block.startLine,
					endLine: block.endLine,
					reused: true,
				},
			], [], 'Paragraph already has a block ID; reusing it.', doc);
		}
		const id = uniqueId(ctx, doc);
		return ready(
			'paragraph',
			[
				{
					anchor: { kind: 'block', id },
					text: textOf(lines, block.startLine, block.endLine),
					startLine: block.startLine,
					endLine: block.endLine,
					reused: false,
				},
			],
			[inlineIdEdit(lines, block.endLine, id)],
			'Added a block ID to the end of the paragraph.',
			doc,
		);
	}

	if (block.kind === 'list') {
		const existing = existingStandaloneId(lines, block.endLine);
		if (existing) {
			return ready('whole-block', [
				{
					anchor: { kind: 'block', id: existing },
					text: textOf(lines, block.startLine, block.endLine),
					startLine: block.startLine,
					endLine: block.endLine,
					reused: true,
				},
			], [], 'List already has a block ID; reusing it.', doc);
		}
		const id = uniqueId(ctx, doc);
		return ready(
			'whole-block',
			[
				{
					anchor: { kind: 'block', id },
					text: textOf(lines, block.startLine, block.endLine),
					startLine: block.startLine,
					endLine: block.endLine,
					reused: false,
				},
			],
			[standaloneIdEdit(lines, block, id)],
			`Added a block ID below the list (${block.items.length} items).`,
			doc,
		);
	}

	// Quote, table and fenced code.
	const existing = existingStandaloneId(lines, block.endLine);
	if (existing) {
		return ready('whole-block', [
			{
				anchor: { kind: 'block', id: existing },
				text: textOf(lines, block.startLine, block.endLine),
				startLine: block.startLine,
				endLine: block.endLine,
				reused: true,
			},
		], [], 'Block already has a block ID; reusing it.', doc);
	}
	const id = uniqueId(ctx, doc);
	const label =
		block.kind === 'code' ? 'code block' : block.kind === 'quote' ? 'blockquote' : 'table';
	return ready(
		'whole-block',
		[
			{
				anchor: { kind: 'block', id },
				text: textOf(lines, block.startLine, block.endLine),
				startLine: block.startLine,
				endLine: block.endLine,
				reused: false,
			},
		],
		[standaloneIdEdit(lines, block, id)],
		`Added a block ID below the ${label}.`,
		doc,
	);
}

function planForListItem(
	lines: DocLine[],
	block: Block,
	item: UnitBounds,
	ctx: AnalyzeContext,
	doc: string,
): Analysis {	const existing = existingInlineId(lines[item.endLine]);
	if (existing) {
		return ready('list-item', [
			{
				anchor: { kind: 'block', id: existing },
				text: textOf(lines, item.startLine, item.endLine),
				startLine: item.startLine,
				endLine: item.endLine,
				reused: true,
			},
		], [], 'List item already has a block ID; reusing it.', doc);
	}

	const id = uniqueId(ctx, doc);
	return ready(
		'list-item',
		[
			{
				anchor: { kind: 'block', id },
				text: textOf(lines, item.startLine, item.endLine),
				startLine: item.startLine,
				endLine: item.endLine,
				reused: false,
			},
		],
		[inlineIdEdit(lines, item.endLine, id)],
		block.items.length === 1
			? 'Added a block ID to the end of the list item.'
			: 'Added a block ID to the end of the list item (not the whole list).',
		doc,
	);
}

function planForHeadingSection(
	lines: DocLine[],
	heading: Block,
	summary: string,
): Analysis {
	return {
		status: 'ready',
		plan: {
			kind: 'heading-section',
			units: [
				{
					anchor: { kind: 'heading', text: heading.headingText },
					text: textOf(lines, heading.startLine, heading.endLine),
					startLine: heading.startLine,
					endLine: heading.endLine,
					reused: false,
				},
			],
			edits: [],
			summary: `${summary} Referencing the whole section instead, so nothing is altered in the source note.`,
			warnings: [],
		},
	};
}

function planForBlocks(
	lines: DocLine[],
	blocks: Block[],
	ctx: AnalyzeContext,
	doc: string,
): Analysis {
	const units: ReferenceUnit[] = [];
	const edits: LineEdit[] = [];
	const warnings: string[] = [];
	const summaries: string[] = [];

	for (const block of blocks) {
		if (block.kind === 'hr') {
			warnings.push('Skipped a horizontal rule: it has no content to reference.');
			continue;
		}
		if (block.kind === 'heading') {
			warnings.push(
				`Skipped the heading “${block.headingText}”: embed the heading's section directly if you need it.`,
			);
			continue;
		}
		if (block.kind === 'paragraph') {
			const existing = existingInlineId(lines[block.endLine]);
			const id = existing ?? uniqueId(ctx, doc);
			if (!existing) edits.push(inlineIdEdit(lines, block.endLine, id));
			units.push({
				anchor: { kind: 'block', id },
				text: textOf(lines, block.startLine, block.endLine),
				startLine: block.startLine,
				endLine: block.endLine,
				reused: existing !== null,
			});
			continue;
		}
		if (block.kind === 'list' && block.items.length === 1) {
			const item = block.items[0];
			const existing = existingInlineId(lines[item.endLine]);
			const id = existing ?? uniqueId(ctx, doc);
			if (!existing) edits.push(inlineIdEdit(lines, item.endLine, id));
			units.push({
				anchor: { kind: 'block', id },
				text: textOf(lines, item.startLine, item.endLine),
				startLine: item.startLine,
				endLine: item.endLine,
				reused: existing !== null,
			});
			continue;
		}
		const existing = existingStandaloneId(lines, block.endLine);
		const id = existing ?? uniqueId(ctx, doc);
		if (!existing) edits.push(standaloneIdEdit(lines, block, id));
		units.push({
			anchor: { kind: 'block', id },
			text: textOf(lines, block.startLine, block.endLine),
			startLine: block.startLine,
			endLine: block.endLine,
			reused: existing !== null,
		});
	}

	if (units.length === 0) {
		return {
			status: 'unsupported',
			reason:
				'Nothing in that selection can be referenced on its own. Select the paragraphs or list items you want, rather than the separators between them.',
		};
	}

	summaries.push(
		units.length === 1
			? 'Created one block reference.'
			: `Split the selection into ${units.length} block references so each passage stays exactly what you selected.`,
	);

	return { status: 'ready', plan: { kind: 'multi-unit', units, edits, summary: summaries.join(' '), warnings } };
}

/* ------------------------------------------------------------------ */
/* Heading sections                                                    */
/* ------------------------------------------------------------------ */

function matchHeadingSection(
	lines: DocLine[],
	blocks: Block[],
	startBlock: Block,
	endBlock: Block,
): Block | null {
	for (const heading of blocks) {
		if (heading.kind !== 'heading') continue;
		if (!isUniqueHeading(blocks, heading)) continue;

		const body = headingSectionBody(lines, blocks, heading);
		if (!body) continue;

		// The selection must be the heading plus its whole body, or exactly the
		// body. Anything else is not what `[[Note#Heading]]` would embed.
		const startsAtHeading = startBlock.startLine === heading.startLine;
		const startsAtBody = startBlock.startLine === body.startLine;
		if (!startsAtHeading && !startsAtBody) continue;
		if (endBlock.endLine !== body.endLine) continue;
		if (startBlock.startLine < heading.startLine) continue;

		return heading;
	}

	return null;
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

function decisionFor(
	blocks: Block[],
	trimmed: SelectionRange,
	widened: SelectionRange,
	startBlock: Block,
): Analysis {
	const widenedTarget = unitBounds(blocks, widened.from.line);
	const targetBlock = findBlockAt(blocks, widened.from.line) ?? startBlock;
	const wholeBlock =
		widened.from.line === targetBlock.startLine && widened.to.line === targetBlock.endLine;

	const options: DecisionOption[] = [];

	options.push({
		id: 'widen',
		label: widenLabel(targetBlock, widenedTarget, wholeBlock),
		description:
			targetBlock.kind === 'code'
				? 'Adds the block ID just after the closing fence, so the whole code block is referenced. The code itself is untouched.'
				: 'Adds the block ID to the enclosing block. The embed will show more than you selected, but the source note keeps its exact wording and structure.',
	});

	if (canSplit(blocks, trimmed)) {
		options.push({
			id: 'split',
			label: 'Split the paragraph so the selection stands alone',
			description:
				'Inserts blank lines before and after your selection, making it its own paragraph, then adds a block ID. Not one word changes, but the paragraph is broken in two.',
		});
	}

	return {
		status: 'decision',
		request: {
			reason: reasonFor(blocks, trimmed),
			options,
			selection: trimmed,
		},
	};
}

function widenLabel(
	block: Block,
	unit: UnitBounds | null,
	wholeBlock: boolean,
): string {
	if (block.kind === 'list' && unit && !wholeBlock) {
		return block.items.length === 1
			? 'Reference the whole list item'
			: 'Reference the whole list item';
	}
	if (block.kind === 'list') {
		return `Reference the whole list (${block.items.length} items)`;
	}
	if (block.kind === 'code') return 'Reference the whole code block';
	if (block.kind === 'quote') return 'Reference the whole blockquote';
	if (block.kind === 'table') return 'Reference the whole table';
	const lineCount = block.endLine - block.startLine + 1;
	return lineCount > 1 ? 'Reference the whole paragraph' : 'Reference the whole line';
}

function reasonFor(blocks: Block[], trimmed: SelectionRange): string {
	const block = findBlockAt(blocks, trimmed.from.line);
	if (!block) return 'That selection cannot be addressed directly.';
	if (block.kind === 'code') {
		return 'Obsidian cannot reference part of a code block, and adding a block ID inside one would change the code.';
	}
	if (block.kind === 'list') {
		return 'Obsidian can only reference a whole list item or a whole list, never part of one.';
	}
	if (block.kind === 'table') {
		return 'Obsidian can only reference a whole table, never individual cells or rows.';
	}
	if (block.kind === 'quote') {
		return 'Obsidian can only reference a whole blockquote, never part of one.';
	}
	return 'Obsidian can only reference whole paragraphs. Your selection covers part of one.';
}

function canSplit(blocks: Block[], trimmed: SelectionRange): boolean {
	const startBlock = findBlockAt(blocks, trimmed.from.line);
	const endBlock = findBlockAt(blocks, trimmed.to.line);
	return (
		startBlock !== null &&
		startBlock === endBlock &&
		startBlock.kind === 'paragraph'
	);
}

/* ------------------------------------------------------------------ */
/* Splitting a paragraph                                               */
/* ------------------------------------------------------------------ */

/**
 * The fallback for "I only want this sentence". Obsidian cannot point at part
 * of a paragraph, so the paragraph is broken into three at the selection
 * boundaries: before, the selection itself, and after. Wording is preserved
 * character for character; only blank lines are introduced.
 */
function planForSplitParagraph(
	lines: DocLine[],
	blocks: Block[],
	trimmed: SelectionRange,
	ctx: AnalyzeContext,
	doc: string,
): Analysis | null {
	const block = findBlockAt(blocks, trimmed.from.line);
	if (!block || block.kind !== 'paragraph') return null;
	if (findBlockAt(blocks, trimmed.to.line) !== block) return null;

	const before = lines
		.slice(block.startLine, trimmed.from.line + 1)
		.map((line, index, all) =>
			index === all.length - 1 ? line.text.slice(0, trimmed.from.ch) : line.text,
		)
		.map((text) => text.replace(/\s+$/, ''));
	while (before.length > 0 && before[before.length - 1] === '') before.pop();

	const middle = lines
		.slice(trimmed.from.line, trimmed.to.line + 1)
		.map((line, index, all) => {
			const isFirst = index === 0;
			const isLast = index === all.length - 1;
			let text = line.text;
			if (isFirst) text = text.slice(trimmed.from.ch);
			if (isLast) text = text.slice(0, trimmed.to.ch - (isFirst ? trimmed.from.ch : 0));
			return text;
		});
	while (middle.length > 0 && middle[0].trim() === '') middle.shift();
	while (middle.length > 0 && middle[middle.length - 1].trim() === '') middle.pop();
	if (middle.length === 0) return null;

	const after = lines
		.slice(trimmed.to.line, block.endLine + 1)
		.map((line, index) => (index === 0 ? line.text.slice(trimmed.to.ch) : line.text))
		.map((text) => text.replace(/^\s+/, ''));
	while (after.length > 0 && after[0] === '') after.shift();

	const id = uniqueId(ctx, doc);
	const replacement: string[] = [];
	if (before.length > 0) replacement.push(...before, '');
	replacement.push(...middle);
	if (after.length > 0) replacement.push('', ...after);

	const middleLastIndex = (before.length > 0 ? before.length + 1 : 0) + middle.length - 1;
	replacement[middleLastIndex] = `${replacement[middleLastIndex].replace(/\s+$/, '')} ^${id}`;

	return {
		status: 'ready',
		plan: {
			kind: 'paragraph',
			units: [
				{
					anchor: { kind: 'block', id },
					text: middle.join('\n'),
					startLine: trimmed.from.line,
					endLine: trimmed.to.line,
					reused: false,
				},
			],
			edits: [{ startLine: block.startLine, endLine: block.endLine, lines: replacement }],
			summary:
				'Split the paragraph around your selection and gave the selection its own block ID. The wording is unchanged.',
			warnings: [
				'The paragraph is now three paragraphs in the source note. Undo (Cmd+Z) reverses it.',
			],
		},
	};
}

/* ------------------------------------------------------------------ */

function ready(
	kind: PlanKind,
	units: ReferenceUnit[],
	edits: LineEdit[],
	summary: string,
	_doc: string,
): Analysis {
	return { status: 'ready', plan: { kind, units, edits, summary, warnings: [] } };
}
