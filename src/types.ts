/**
 * How a reference to a passage is rendered in the destination note.
 *
 * All three modes point at the same block reference; they only change what the
 * reader sees. Nothing is ever duplicated into the destination note.
 */
export type ReferenceDisplayMode = 'embed' | 'link' | 'both';

export interface EvergreenRefactorSettings {
	/** How references are rendered in destination notes. */
	displayMode: ReferenceDisplayMode;
	/**
	 * Folder for notes created from the destination picker.
	 * An empty string or `/` means the vault root.
	 */
	newNoteFolder: string;
}

export const DEFAULT_SETTINGS: EvergreenRefactorSettings = {
	displayMode: 'embed',
	newNoteFolder: '',
};

export const DISPLAY_MODE_LABELS: Record<ReferenceDisplayMode, string> = {
	embed: 'Full embedded passage',
	link: 'Short clickable preview',
	both: 'Readable link, then full embed',
};

/**
 * Settings come from `data.json`, which the user can edit by hand, so nothing
 * stored there is trusted.
 */
export function coerceSettings(raw: unknown): EvergreenRefactorSettings {
	const input = (raw ?? {}) as Partial<EvergreenRefactorSettings>;
	const mode = input.displayMode;
	return {
		displayMode:
			mode === 'embed' || mode === 'link' || mode === 'both'
				? mode
				: DEFAULT_SETTINGS.displayMode,
		newNoteFolder:
			typeof input.newNoteFolder === 'string'
				? input.newNoteFolder
				: DEFAULT_SETTINGS.newNoteFolder,
	};
}
