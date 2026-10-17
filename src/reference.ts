/**
 * Building the Markdown that goes into destination notes.
 *
 * Everything here is native Obsidian syntax. Nothing is copied: an embed points
 * at the block ID in the source note, so editing the original text updates
 * every note that references it.
 */

import type { Anchor } from './selection-plan.ts';
import type { ReferenceDisplayMode } from './types.ts';

export const PREVIEW_WORD_LIMIT = 8;
export const PREVIEW_CHAR_LIMIT = 64;

const HEADING_MARKER_RE = /^\s{0,3}#{1,6}(?:\s+|$)/;
const QUOTE_MARKER_RE = /^\s*>\s?/;
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s+|$)/;
const TASK_MARKER_RE = /^\[[ xX]\]\s*/;
const INLINE_CODE_RE = /`([^`]*)`/g;
const WIKI_LINK_RE = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;
const MD_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const REF_LINK_RE = /\[([^\]]*)\]\[[^\]]*\]/g;
const EMPHASIS_RE = /(\*\*|__|\*|_|~~)/g;

/**
 * Flatten a passage into readable prose for use as a link alias. Only the
 * preview is affected — the source text is never modified.
 */
export function stripMarkdown(text: string): string {
	return text
		.split('\n')
		.map((line) =>
			line
				.replace(HEADING_MARKER_RE, '')
				.replace(QUOTE_MARKER_RE, '')
				.replace(LIST_MARKER_RE, '')
				.replace(TASK_MARKER_RE, ''),
		)
		.join(' ')
		.replace(INLINE_CODE_RE, '$1')
		.replace(WIKI_LINK_RE, (_match, target: string, alias: string | undefined) =>
			alias && alias.length > 0 ? alias : target,
		)
		.replace(MD_LINK_RE, '$1')
		.replace(REF_LINK_RE, '$1')
		.replace(EMPHASIS_RE, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * "First few words…" for the short-link display mode.
 *
 * `|`, `[` and `]` are stripped because they would terminate the link alias and
 * silently produce broken Markdown.
 */
export function createPreview(
	text: string,
	wordLimit: number = PREVIEW_WORD_LIMIT,
	charLimit: number = PREVIEW_CHAR_LIMIT,
): string {
	const clean = stripMarkdown(text)
		.replace(/[|[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (clean.length === 0) return 'Reference';

	const words = clean.split(' ');
	const kept: string[] = [];
	for (const word of words) {
		if (kept.length >= wordLimit) break;
		const candidate = [...kept, word].join(' ');
		if (candidate.length > charLimit && kept.length > 0) break;
		kept.push(word);
	}

	const truncated = kept.length < words.length;
	const preview = kept.join(' ').slice(0, charLimit).trim();
	return truncated ? `${preview}…` : preview;
}

export function anchorSuffix(anchor: Anchor): string {
	return anchor.kind === 'block' ? `#^${anchor.id}` : `#${anchor.text}`;
}

/**
 * The Markdown lines to append to a destination note.
 *
 * @param target the source note as it should appear inside `[[…]]`
 */
export function buildReferenceLines(
	target: string,
	anchor: Anchor,
	preview: string,
	mode: ReferenceDisplayMode,
): string[] {
	const link = `${target}${anchorSuffix(anchor)}`;
	const embed = `![[${link}]]`;

	if (mode === 'embed') return [embed];

	const short = `[[${link}|${preview}]]`;
	if (mode === 'link') return [short];
	return [short, embed];
}

/**
 * Names that cannot appear inside a wiki link. Obsidian offers no escape for
 * these, so the plugin refuses rather than writing a link that will not resolve.
 */
export function unusableTargetReason(target: string): string | null {
	if (/[#^|[\]]/.test(target)) {
		return `The note name “${target}” contains one of # ^ | [ ], which Obsidian cannot put inside a link. Rename the note (or move it into a folder) and try again.`;
	}
	return null;
}
