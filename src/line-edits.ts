/**
 * Source edits are expressed as whole-line replacements rather than character
 * offsets. Every change this plugin makes to the original note — adding a block
 * ID, splitting a paragraph — is naturally a rewrite of a contiguous run of
 * lines, and line-based edits stay valid when several are applied at once.
 */

export interface LineEdit {
	/** First line replaced, inclusive. */
	startLine: number;
	/** Last line replaced, inclusive. */
	endLine: number;
	/** The lines that take their place. */
	lines: string[];
}

/**
 * Apply edits bottom-up so earlier line numbers stay meaningful. Overlapping
 * edits are a bug in the caller, so they throw rather than corrupt the note.
 */
export function applyLineEdits(lines: string[], edits: LineEdit[]): string[] {
	const sorted = [...edits].sort(
		(a, b) => b.startLine - a.startLine || b.endLine - a.endLine,
	);
	const out = [...lines];
	let lowestTouched = Number.POSITIVE_INFINITY;

	for (const edit of sorted) {
		if (edit.endLine >= lowestTouched) {
			throw new Error(
				`Overlapping edits: [${edit.startLine}, ${edit.endLine}] collides with an edit at line ${lowestTouched}`,
			);
		}
		out.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.lines);
		lowestTouched = edit.startLine;
	}

	return out;
}

/**
 * True when the line after a block is already blank, so an inserted block ID
 * does not need its own trailing blank line. At the end of a note there is no
 * blank line yet, and a Markdown file should end with one.
 */
export function hasBlankAfter(lines: string[], endLine: number): boolean {
	const next = lines[endLine + 1];
	return next !== undefined && next.trim() === '';
}
