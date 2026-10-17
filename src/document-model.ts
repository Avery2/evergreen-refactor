/**
 * A small, dependency-free model of how Obsidian sees a Markdown note.
 *
 * The plugin needs to answer two questions before it touches anything:
 *
 *   1. Which "block" (the unit Obsidian can address with `^block-id`) does the
 *      cursor sit in?
 *   2. Is the selection exactly that block, or only part of it?
 *
 * This module answers both without importing anything from `obsidian`, so it
 * can be unit tested in plain Node.
 */

export type LineKind =
	| 'blank'
	| 'fence'
	| 'heading'
	| 'listItem'
	| 'quote'
	| 'table'
	| 'hr'
	| 'text';

export interface DocLine {
	index: number;
	text: string;
	kind: LineKind;
	/** Leading whitespace width, with tabs counted as four columns. */
	indent: number;
	/** True for fence markers and everything between them. */
	inFence: boolean;
}

export type BlockKind =
	| 'paragraph'
	| 'list'
	| 'quote'
	| 'table'
	| 'heading'
	| 'code'
	| 'hr';

export interface ListItemRange {
	startLine: number;
	endLine: number;
	indent: number;
}

export interface Block {
	kind: BlockKind;
	startLine: number;
	endLine: number;
	/** Populated for `list` blocks; nested items are included. */
	items: ListItemRange[];
	headingLevel: number;
	headingText: string;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/;
const HEADING_TEXT_RE = /^\s{0,3}#{1,6}\s*/;
const HEADING_CLOSING_RE = /\s+#+\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const QUOTE_RE = /^\s*>/;
const TABLE_RE = /^\s*\|/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function indentWidth(text: string): number {
	let width = 0;
	for (const char of text) {
		if (char === ' ') width += 1;
		else if (char === '\t') width += 4;
		else break;
	}
	return width;
}

/**
 * The column where the block's own content starts.
 *
 * For a list item this is *after* the bullet, so a user who drags across the
 * text of `- buy milk` (starting at the `b`) still counts as having selected
 * the whole item.
 */
export function contentStartColumn(line: DocLine): number {
	if (line.kind === 'listItem') {
		const match = LIST_ITEM_RE.exec(line.text);
		if (match) return match[0].length;
	}
	return line.indent;
}

/**
 * A block ID written at the end of a line is not part of the passage it labels.
 * Obsidian hides it when rendering, and selecting the visible text should count
 * as selecting the whole block.
 */
const TRAILING_BLOCK_ID_RE = /\s+\^[A-Za-z0-9-]+\s*$/;

/** Column just past the last non-whitespace character, ignoring a block ID. */
export function contentEndColumn(line: DocLine): number {
	return line.text.replace(TRAILING_BLOCK_ID_RE, '').replace(/\s+$/, '').length;
}

export function classifyLines(lines: string[]): DocLine[] {
	const out: DocLine[] = [];
	let fenceChar: string | null = null;
	let fenceLength = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const text = lines[i];
		const indent = indentWidth(text);
		const fenceMatch = FENCE_RE.exec(text);

		if (fenceChar !== null) {
			const closes =
				fenceMatch !== null &&
				fenceMatch[2][0] === fenceChar &&
				fenceMatch[2].length >= fenceLength &&
				fenceMatch[3].trim() === '';
			out.push({ index: i, text, kind: 'fence', indent, inFence: true });
			if (closes) {
				fenceChar = null;
				fenceLength = 0;
			}
			continue;
		}

		if (fenceMatch !== null) {
			fenceChar = fenceMatch[2][0];
			fenceLength = fenceMatch[2].length;
			out.push({ index: i, text, kind: 'fence', indent, inFence: true });
			continue;
		}

		let kind: LineKind;
		if (text.trim() === '') kind = 'blank';
		else if (HEADING_RE.test(text)) kind = 'heading';
		else if (HR_RE.test(text)) kind = 'hr';
		else if (LIST_ITEM_RE.test(text)) kind = 'listItem';
		else if (QUOTE_RE.test(text)) kind = 'quote';
		else if (TABLE_RE.test(text)) kind = 'table';
		else kind = 'text';

		out.push({ index: i, text, kind, indent, inFence: false });
	}

	return out;
}

function makeBlock(kind: BlockKind, startLine: number, endLine: number): Block {
	return { kind, startLine, endLine, items: [], headingLevel: 0, headingText: '' };
}

/**
 * Group classified lines into the units Obsidian can address.
 *
 * Blank lines separate blocks, so `a\n\nb` is two blocks while `a\nb` is one —
 * which matches how Obsidian decides what a block reference covers.
 */
export function buildBlocks(lines: DocLine[]): Block[] {
	const blocks: Block[] = [];
	const count = lines.length;
	let i = 0;

	/** A line that always starts a fresh block rather than continuing one. */
	const breaksBlock = (index: number): boolean => {
		const kind = lines[index].kind;
		return (
			kind === 'blank' ||
			kind === 'heading' ||
			kind === 'fence' ||
			kind === 'hr' ||
			kind === 'quote' ||
			kind === 'table'
		);
	};

	while (i < count) {
		const line = lines[i];

		if (line.kind === 'blank') {
			i += 1;
			continue;
		}

		if (line.kind === 'fence') {
			// The opening fence and everything up to (and including) the closing
			// fence form one block, even though the interior lines are also
			// classified as `fence`.
			let end = i;
			while (end + 1 < count && lines[end + 1].kind === 'fence') end += 1;
			blocks.push(makeBlock('code', i, end));
			i = end + 1;
			continue;
		}

		if (line.kind === 'heading') {
			const block = makeBlock('heading', i, i);
			block.headingLevel = headingLevel(line.text);
			block.headingText = headingText(line.text);
			blocks.push(block);
			i += 1;
			continue;
		}

		if (line.kind === 'hr') {
			blocks.push(makeBlock('hr', i, i));
			i += 1;
			continue;
		}

		if (line.kind === 'listItem') {
			let end = i;
			while (end + 1 < count && !breaksBlock(end + 1)) end += 1;
			const block = makeBlock('list', i, end);
			block.items = collectListItems(lines, i, end);
			blocks.push(block);
			i = end + 1;
			continue;
		}

		if (line.kind === 'quote') {
			let end = i;
			while (end + 1 < count && lines[end + 1].kind === 'quote') end += 1;
			blocks.push(makeBlock('quote', i, end));
			i = end + 1;
			continue;
		}

		if (line.kind === 'table') {
			let end = i;
			while (end + 1 < count && lines[end + 1].kind === 'table') end += 1;
			blocks.push(makeBlock('table', i, end));
			i = end + 1;
			continue;
		}

		let end = i;
		while (end + 1 < count && lines[end + 1].kind === 'text') end += 1;
		blocks.push(makeBlock('paragraph', i, end));
		i = end + 1;
	}

	return blocks;
}

function headingLevel(text: string): number {
	const match = /^\s{0,3}(#{1,6})/.exec(text);
	return match ? match[1].length : 1;
}

export function headingText(text: string): string {
	return text
		.replace(HEADING_TEXT_RE, '')
		.replace(HEADING_CLOSING_RE, '')
		.trim();
}

/**
 * Resolve list items using an indent stack, so a nested item's lines belong to
 * its parent item as well. Selecting the outer item therefore covers its
 * children, exactly as Obsidian's own block cache treats it.
 */
export function collectListItems(
	lines: DocLine[],
	start: number,
	end: number,
): ListItemRange[] {
	const items: ListItemRange[] = [];
	const stack: ListItemRange[] = [];

	for (let i = start; i <= end; i += 1) {
		const line = lines[i];
		if (line.kind !== 'listItem') continue;

		while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) {
			const closed = stack.pop();
			if (closed) {
				closed.endLine = i - 1;
				items.push(closed);
			}
		}

		stack.push({ startLine: i, endLine: end, indent: line.indent });
	}

	while (stack.length > 0) {
		const closed = stack.pop();
		if (closed) {
			closed.endLine = end;
			items.push(closed);
		}
	}

	items.sort((a, b) => a.startLine - b.startLine);
	return items;
}

export function findBlockAt(blocks: Block[], line: number): Block | null {
	for (const block of blocks) {
		if (line >= block.startLine && line <= block.endLine) return block;
	}
	return null;
}

export function findListItemAt(block: Block, line: number): ListItemRange | null {
	for (const item of block.items) {
		if (line >= item.startLine && line <= item.endLine) return item;
	}
	return null;
}

/**
 * The first and last line of the content under a heading, excluding blank
 * padding and stopping at the next heading of the same or higher level.
 *
 * This is what `[[Note#Heading]]` embeds, so it is the only range a heading
 * reference can stand in for.
 */
export function headingSectionBody(
	lines: DocLine[],
	blocks: Block[],
	heading: Block,
): { startLine: number; endLine: number } | null {
	const sectionEnd = sectionEndLine(blocks, heading);
	let start = heading.endLine + 1;
	while (start <= sectionEnd && lines[start].kind === 'blank') start += 1;

	let end = sectionEnd;
	while (end >= start && lines[end].kind === 'blank') end -= 1;

	if (start > end) return null;
	return { startLine: start, endLine: end };
}

function sectionEndLine(blocks: Block[], heading: Block): number {
	const next = blocks.find(
		(block) =>
			block.kind === 'heading' &&
			block.startLine > heading.startLine &&
			block.headingLevel <= heading.headingLevel,
	);
	return next ? next.startLine - 1 : blocks[blocks.length - 1].endLine;
}

/** A heading reference is only unambiguous if the heading text is unique. */
export function isUniqueHeading(blocks: Block[], heading: Block): boolean {
	if (heading.headingText.length === 0) return false;
	if (/[#^|[\]]/.test(heading.headingText)) return false;
	const matches = blocks.filter(
		(block) => block.kind === 'heading' && block.headingText === heading.headingText,
	);
	return matches.length === 1;
}
