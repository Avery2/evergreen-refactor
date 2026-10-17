/**
 * Renaming a block ID and updating every reference to it.
 *
 * This is the block-level equivalent of Obsidian's "rename a note and update
 * all its links", which the app does for files but not for blocks.
 *
 * Everything here is pure so the rewrite rules can be tested without a vault.
 * Finding the references uses Obsidian's metadata cache (see main.ts); this
 * module only decides what a link means and how to rewrite it.
 */

import {
	type DocLine,
	buildBlocks,
	classifyLines,
	findBlockAt,
} from './document-model.ts';

/** A block ID definition written at the end of a line. */
const INLINE_DEF_RE = /^(.*\S)[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
/** A block ID definition written on a line of its own. */
const STANDALONE_DEF_RE = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const WIKI_LINK_RE = /^(!?)\[\[([^\]]+)\]\]$/;

export interface ParsedWikiLink {
	embedded: boolean;
	/** Everything before the `#`, i.e. the note name or path. Empty for `[[#^id]]`. */
	target: string;
	/** Everything after the `#`, e.g. `^20261016-164300-a7c9` or `Some heading`. */
	anchor: string;
	alias: string | null;
}

/** A place where a link to a block lives, positioned precisely for rewriting. */
export interface ReferenceSite {
	line: number;
	col: number;
}

/**
 * Split a raw `[[…]]` / `![[…]]` into its parts.
 *
 * Obsidian gives us the untouched link text in the metadata cache, so parsing
 * it ourselves is more reliable than trusting the cache's own `link` field,
 * which is normalised and differs between links and embeds.
 */
export function parseWikiLink(original: string): ParsedWikiLink | null {
	const match = WIKI_LINK_RE.exec(original.trim());
	if (!match) return null;

	const embedded = match[1] === '!';
	const inner = match[2];

	const pipe = inner.indexOf('|');
	const alias = pipe === -1 ? null : inner.slice(pipe + 1);
	const body = pipe === -1 ? inner : inner.slice(0, pipe);

	const hash = body.indexOf('#');
	if (hash === -1) {
		return { embedded, target: body, anchor: '', alias };
	}

	return {
		embedded,
		target: body.slice(0, hash),
		anchor: body.slice(hash + 1),
		alias,
	};
}

/** `^abc123` -> `abc123`; anything else (a heading anchor) -> null. */
export function blockIdFromAnchor(anchor: string): string | null {
	if (!anchor.startsWith('^')) return null;
	const id = anchor.slice(1);
	return id.length > 0 ? id : null;
}

const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;

export function isValidBlockIdCandidate(value: string): boolean {
	return value.length > 0 && value.length <= 64 && BLOCK_ID_RE.test(value);
}

/** Tidy a typed value into something Obsidian will accept as a block ID. */
export function sanitizeBlockIdInput(value: string): string {
	return value.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9-]/g, '');
}

/** Every block ID defined in a note, in document order. */
export function findBlockIdDefinitions(
	lines: string[],
): Array<{ line: number; id: string; standalone: boolean }> {
	const found: Array<{ line: number; id: string; standalone: boolean }> = [];

	for (let i = 0; i < lines.length; i += 1) {
		const inline = INLINE_DEF_RE.exec(lines[i]);
		if (inline) {
			found.push({ line: i, id: inline[2], standalone: false });
			continue;
		}
		const standalone = STANDALONE_DEF_RE.exec(lines[i]);
		if (standalone) found.push({ line: i, id: standalone[1], standalone: true });
	}

	return found;
}

/**
 * The block ID that the cursor is sitting on, if any.
 *
 * Accepts the cursor being anywhere in a block that carries an ID, or on the
 * standalone ID line beneath one, so it does not matter which of the two the
 * user happened to click.
 */
export function findBlockIdAt(
	lines: string[],
	cursorLine: number,
): { id: string; line: number; standalone: boolean } | null {
	const onIdLine = STANDALONE_DEF_RE.exec(lines[cursorLine] ?? '');
	if (onIdLine) return { id: onIdLine[1], line: cursorLine, standalone: true };

	const docLines: DocLine[] = classifyLines(lines);
	const blocks = buildBlocks(docLines);
	const block = findBlockAt(blocks, cursorLine);
	if (!block) return null;

	const inline = INLINE_DEF_RE.exec(lines[block.endLine] ?? '');
	if (inline) return { id: inline[2], line: block.endLine, standalone: false };

	const found = findBlockIdDefinitions(lines).find(
		(definition) => definition.standalone && definition.line > block.endLine,
	);
	if (!found) return null;

	// Only claim it if nothing but blank lines separate the ID from the block.
	const between = lines.slice(block.endLine + 1, found.line);
	if (between.some((line) => line.trim().length > 0)) return null;

	return found;
}

/** True when the note already defines this block ID, which would be ambiguous. */
export function hasBlockIdDefinition(lines: string[], id: string): boolean {
	return findBlockIdDefinitions(lines).some((definition) => definition.id === id);
}

/** Rename the ID where it is *defined*, i.e. in the source note itself. */
export function renameBlockIdDefinition(
	lines: string[],
	oldId: string,
	newId: string,
): { lines: string[]; replaced: number } {
	const out = [...lines];
	let replaced = 0;

	for (let i = 0; i < out.length; i += 1) {
		const inline = INLINE_DEF_RE.exec(out[i]);
		if (inline && inline[2] === oldId) {
			out[i] = `${inline[1]} ^${newId}`;
			replaced += 1;
			continue;
		}

		const standalone = STANDALONE_DEF_RE.exec(out[i]);
		if (standalone && standalone[1] === oldId) {
			out[i] = `^${newId}`;
			replaced += 1;
		}
	}

	return { lines: out, replaced };
}

/**
 * Rename the anchor inside links that point at the block.
 *
 * Sites are applied bottom-up and right-to-left: a replacement can change the
 * line's length, so anything earlier in the line has to be rewritten after
 * everything later in it, or the recorded columns would drift.
 */
export function rewriteLinkAnchors(
	lines: string[],
	sites: readonly ReferenceSite[],
	oldId: string,
	newId: string,
): { lines: string[]; replaced: number } {
	const out = [...lines];
	let replaced = 0;

	const ordered = [...sites].sort((a, b) => b.line - a.line || b.col - a.col);

	for (const site of ordered) {
		const line = out[site.line];
		if (line === undefined) continue;

		const head = line.slice(0, site.col);
		const tail = line.slice(site.col);
		const next = tail.replace(`#^${oldId}`, `#^${newId}`);
		if (next === tail) continue;

		out[site.line] = head + next;
		replaced += 1;
	}

	return { lines: out, replaced };
}
