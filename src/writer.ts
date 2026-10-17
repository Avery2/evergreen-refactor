/**
 * Appending references to destination notes.
 *
 * Two rules matter here:
 *
 *   1. Nothing is ever overwritten. References are appended after a blank line.
 *   2. Running the same operation twice must not double up. The check looks for
 *      the anchor inside an actual wiki link, so a passing mention of the same
 *      words in prose does not count as "already referenced".
 */

import type { Anchor } from './selection-plan.ts';

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches `#^id` or `#Heading` only when it is the anchor of a link, i.e.
 * followed by `|`, `]` or `#`.
 */
export function anchorPattern(anchor: Anchor): RegExp {
	const body =
		anchor.kind === 'block'
			? `#\\^${escapeRegExp(anchor.id)}`
			: `#${escapeRegExp(anchor.text)}`;
	return new RegExp(`${body}(?=[\\]|#])`);
}

export function hasReference(content: string, anchor: Anchor): boolean {
	return anchorPattern(anchor).test(content);
}

/**
 * The subset of references a note does not already contain.
 *
 * Running the same operation twice is a normal thing to do — the user may have
 * added a note to the list, or simply forgotten — so "already referenced" is
 * filtered out here rather than appended a second time.
 */
export function missingReferences<T extends { anchor: Anchor }>(
	content: string,
	prepared: readonly T[],
): T[] {
	return prepared.filter((entry) => !hasReference(content, entry.anchor));
}

/** Append a block of reference lines, keeping exactly one blank line of padding. */
export function appendReferenceBlock(content: string, lines: string[]): string {
	const body = content.replace(/\s+$/, '');
	const block = lines.join('\n');
	return body.length > 0 ? `${body}\n\n${block}\n` : `${block}\n`;
}
