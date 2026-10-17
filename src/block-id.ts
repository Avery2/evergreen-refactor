/**
 * Block identifiers.
 *
 * Obsidian only requires a block ID to be unique within its own note, but a
 * timestamp prefix is still worth it:
 *
 *   - `20261016-164300-a7c9` sorts chronologically, so scanning a raw mind
 *     dump for its block IDs reads as a rough timeline of when each passage
 *     was promoted into structure.
 *   - The random suffix keeps two references created in the same second apart.
 *
 * The alphabet is deliberately restricted to what Obsidian accepts in a block
 * ID (`[A-Za-z0-9-]`) and to what survives being typed by hand.
 */

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 4;

/** A block ID is valid if Obsidian will resolve it and it cannot break a link. */
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;

export function isValidBlockId(id: string): boolean {
	return id.length > 0 && BLOCK_ID_RE.test(id);
}

/** `2026-10-16 16:43:00` -> `20261016-164300`, in local time. */
export function formatTimestamp(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
	const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `${datePart}-${timePart}`;
}

export function createBlockId(date: Date, suffix: string): string {
	const clean = suffix.toLowerCase().replace(/[^a-z0-9]/g, '');
	return `${formatTimestamp(date)}-${clean}`;
}

export function randomBlockIdSuffix(): string {
	let out = '';
	for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
		out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
	}
	return out;
}

/** Convenience factory used by the plugin at runtime. */
export function newBlockId(date: Date = new Date()): string {
	return createBlockId(date, randomBlockIdSuffix());
}
