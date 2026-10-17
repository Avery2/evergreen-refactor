/**
 * Working out where a newly created note should live.
 *
 * Kept separate from the modal so the path rules can be tested without an
 * Obsidian instance.
 */

const ILLEGAL_IN_FILENAME = /[\\/:*?"<>|#^[\]]/g;

/** Turn whatever the user typed into something safe to use as a note name. */
export function sanitizeNoteTitle(title: string): string {
	return title
		.replace(ILLEGAL_IN_FILENAME, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\.+$/, '')
		.trim();
}

export function joinVaultPath(folder: string, title: string): string {
	const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
	return cleanFolder.length > 0 ? `${cleanFolder}/${title}.md` : `${title}.md`;
}
