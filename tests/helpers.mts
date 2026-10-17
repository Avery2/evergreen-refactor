import type { SelectionPlan, SelectionRange, SourcePosition } from '../src/selection-plan.ts';
import { applyLineEdits } from '../src/line-edits.ts';

export function positionOf(doc: string, offset: number): SourcePosition {
	const before = doc.slice(0, offset);
	const lines = before.split('\n');
	return { line: lines.length - 1, ch: lines[lines.length - 1].length };
}

/** Select the Nth occurrence of a literal substring. */
export function select(doc: string, needle: string, occurrence = 1): SelectionRange {
	let index = -1;
	let searchFrom = 0;
	for (let i = 0; i < occurrence; i += 1) {
		index = doc.indexOf(needle, searchFrom);
		if (index === -1) throw new Error(`Test helper could not find: ${needle}`);
		searchFrom = index + 1;
	}
	return { from: positionOf(doc, index), to: positionOf(doc, index + needle.length) };
}

/** Select whole lines, from column 0 to the end of `endLine`. */
export function selectLines(doc: string, startLine: number, endLine: number = startLine): SelectionRange {
	const lines = doc.split('\n');
	return { from: { line: startLine, ch: 0 }, to: { line: endLine, ch: lines[endLine].length } };
}

/** What the source note looks like after the plan's edits are applied. */
export function applyPlan(doc: string, plan: SelectionPlan): string {
	return applyLineEdits(doc.split('\n'), plan.edits).join('\n');
}

/** Deterministic, recognisable block IDs: `20261016-164300-a001`, `-a002`, … */
export function sequentialIds(): () => string {
	let n = 0;
	return () => {
		n += 1;
		return `20261016-164300-a${String(n).padStart(3, '0')}`;
	};
}

export function constantId(id: string): () => string {
	return () => id;
}
