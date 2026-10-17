import {
	type App,
	Modal,
	Notice,
	type TFile,
	prepareFuzzySearch,
} from 'obsidian';

import type { DecisionOption, DecisionOptionId, DecisionRequest } from './selection-plan.ts';

/**
 * Shown only when Obsidian cannot address exactly what was selected.
 *
 * The plugin never guesses here: it explains the limitation and lets the user
 * choose between the honest alternatives, or cancel.
 */
export class DecisionModal extends Modal {
	private readonly request: DecisionRequest;
	private resolver: ((value: DecisionOptionId | null) => void) | null = null;
	private settled = false;

	constructor(app: App, request: DecisionRequest) {
		super(app);
		this.request = request;
	}

	openAndWait(): Promise<DecisionOptionId | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	override onOpen(): void {
		this.modalEl.addClass('evergreen-refactor-decision');
		this.titleEl.setText('How should this selection be referenced?');
		this.contentEl.createEl('p', {
			cls: 'evergreen-refactor-reason',
			text: this.request.reason,
		});

		const list = this.contentEl.createDiv({ cls: 'evergreen-refactor-options' });
		let firstButton: HTMLButtonElement | null = null;
		for (const option of this.request.options) {
			const button = this.renderOption(list, option);
			firstButton ??= button;
		}

		const cancel = this.contentEl.createEl('button', {
			cls: 'evergreen-refactor-cancel',
			text: 'Cancel — change the selection instead',
		});
		cancel.addEventListener('click', () => this.close());

		window.setTimeout(() => firstButton?.focus(), 0);
	}

	private renderOption(parent: HTMLElement, option: DecisionOption): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'evergreen-refactor-option' });
		button.createDiv({ cls: 'evergreen-refactor-option-label', text: option.label });
		button.createDiv({ cls: 'evergreen-refactor-option-desc', text: option.description });
		button.addEventListener('click', () => {
			this.settled = true;
			this.resolver?.(option.id);
			this.resolver = null;
			this.close();
		});
		return button;
	}

	override onClose(): void {
		super.onClose();
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.resolver?.(null);
			this.resolver = null;
		}
	}
}

export interface FileChoice {
	kind: 'file';
	file: TFile;
}

export interface CreateChoice {
	kind: 'create';
	title: string;
	path: string;
}

export type DestinationChoice = FileChoice | CreateChoice;

export type DestinationMode = 'single' | 'multiple';

export interface DestinationModalOptions {
	/**
	 * `single` writes the reference as soon as a note is chosen, because that is
	 * the common case and an extra confirm keystroke for it is pure friction.
	 * `multiple` keeps the picker open so several notes can be accumulated.
	 */
	mode: DestinationMode;
	/** Full vault path for a note that would be created from a typed title. */
	pathForNewNote: (title: string) => string;
	/** Note the passage came from, so it can be labelled in the list. */
	sourceFile: TFile;
}

const RESULT_LIMIT = 60;

/**
 * A multi-select version of Obsidian's own "switch to a note" picker.
 *
 * Enter adds or removes a note, Cmd/Ctrl+Enter confirms, and anything typed that
 * does not match an existing note can be turned into a new note on the spot.
 * This is the one interaction the plugin asks for, so it stays on the keyboard.
 */
export class DestinationModal extends Modal {
	private readonly options: DestinationModalOptions;
	private readonly selected = new Map<string, DestinationChoice>();
	private resolver: ((value: DestinationChoice[] | null) => void) | null = null;
	private settled = false;
	private confirmed = false;

	private inputEl!: HTMLInputElement;
	private resultsEl!: HTMLElement;
	private footerEl!: HTMLElement;
	private results: DestinationChoice[] = [];
	private activeIndex = 0;

	constructor(app: App, options: DestinationModalOptions) {
		super(app);
		this.options = options;
	}

	openAndWait(): Promise<DestinationChoice[] | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	override onOpen(): void {
		this.modalEl.addClass('evergreen-refactor-destination');
		this.titleEl.setText(
			this.options.mode === 'single'
				? 'Reference this passage in…'
				: 'Reference this passage in several notes…',
		);

		this.inputEl = this.contentEl.createEl('input', {
			cls: 'evergreen-refactor-input',
			attr: {
				type: 'text',
				placeholder: 'Search notes, or type a name to create one',
				spellcheck: 'false',
			},
		});
		this.inputEl.addEventListener('input', () => this.refreshResults());
		this.inputEl.addEventListener('keydown', (event) => this.onKeyDown(event));

		this.resultsEl = this.contentEl.createDiv({ cls: 'evergreen-refactor-results' });
		this.footerEl = this.contentEl.createDiv({ cls: 'evergreen-refactor-footer' });

		this.scope.register(['Mod'], 'Enter', () => {
			this.confirm();
			return false;
		});

		this.refreshResults();
		window.setTimeout(() => this.inputEl.focus(), 0);
	}

	private onKeyDown(event: KeyboardEvent): void {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				this.moveActive(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				this.moveActive(-1);
				break;
			case 'Enter':
				event.preventDefault();
				if (event.metaKey || event.ctrlKey) this.confirm();
				else this.toggleActive();
				break;
			case 'Escape':
				event.preventDefault();
				this.close();
				break;
			default:
				break;
		}
	}

	private moveActive(delta: number): void {
		if (this.results.length === 0) return;
		this.activeIndex = (this.activeIndex + delta + this.results.length) % this.results.length;
		this.renderResults();
	}

	private toggleActive(): void {
		const choice = this.results[this.activeIndex];
		if (choice) this.toggle(choice);
	}

	private toggle(choice: DestinationChoice): void {
		const key = keyOf(choice);

		// Single-note mode: choosing *is* confirming.
		if (this.options.mode === 'single') {
			this.selected.set(key, choice);
			this.confirmed = true;
			this.close();
			return;
		}

		if (this.selected.has(key)) this.selected.delete(key);
		else this.selected.set(key, choice);
		this.renderResults();
		this.renderFooter();
	}

	private confirm(): void {
		if (this.confirmed) return;
		// In single-note mode there is nothing left to confirm.
		if (this.options.mode === 'single') return;
		if (this.selected.size === 0) {
			new Notice('Pick at least one note, or press Escape to cancel.');
			return;
		}
		this.confirmed = true;
		this.close();
	}

	private refreshResults(): void {
		this.results = this.buildResults(this.inputEl.value);
		this.activeIndex = 0;
		this.renderResults();
		this.renderFooter();
	}

	private buildResults(query: string): DestinationChoice[] {
		const trimmed = query.trim();
		const out: DestinationChoice[] = [];
		const files = this.app.vault.getMarkdownFiles();

		if (trimmed.length > 0) {
			const exact = files.some(
				(file) =>
					file.basename.toLowerCase() === trimmed.toLowerCase() ||
					file.path.replace(/\.md$/i, '').toLowerCase() === trimmed.toLowerCase(),
			);
			if (!exact) {
				out.push({
					kind: 'create',
					title: trimmed,
					path: this.options.pathForNewNote(trimmed),
				});
			}
		}

		const limit = RESULT_LIMIT - out.length;

		if (trimmed.length === 0) {
			const recent = [...files]
				.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0))
				.slice(0, limit);
			out.push(...recent.map((file): FileChoice => ({ kind: 'file', file })));
			return out;
		}

		const search = prepareFuzzySearch(trimmed);
		const scored: Array<{ file: TFile; score: number }> = [];
		for (const file of files) {
			const result = search(file.path.replace(/\.md$/i, ''));
			if (result) scored.push({ file, score: result.score });
		}
		scored.sort((a, b) => b.score - a.score);
		out.push(...scored.slice(0, limit).map((entry): FileChoice => ({ kind: 'file', file: entry.file })));
		return out;
	}

	private renderResults(): void {
		this.resultsEl.empty();

		if (this.results.length === 0) {
			this.resultsEl.createDiv({
				cls: 'evergreen-refactor-empty',
				text: 'No notes match. Keep typing to create a new note.',
			});
			return;
		}

		this.results.forEach((choice, index) => {
			const key = keyOf(choice);
			const isSelected = this.selected.has(key);
			const el = this.resultsEl.createDiv({ cls: 'evergreen-refactor-result' });
			el.toggleClass('is-active', index === this.activeIndex);
			el.toggleClass('is-selected', isSelected);
			el.toggleClass('is-create', choice.kind === 'create');

			el.createSpan({ cls: 'evergreen-refactor-check', text: isSelected ? '✓' : '' });

			if (choice.kind === 'create') {
				el.createSpan({
					cls: 'evergreen-refactor-result-title',
					text: `Create “${choice.title}”`,
				});
				el.createSpan({ cls: 'evergreen-refactor-result-path', text: choice.path });
			} else {
				el.createSpan({ cls: 'evergreen-refactor-result-title', text: choice.file.basename });
				const parent = choice.file.parent?.path ?? '';
				const detail =
					choice.file.path === this.options.sourceFile.path
						? 'this note'
						: parent === '/' || parent.length === 0
							? ''
							: parent;
				if (detail.length > 0) {
					el.createSpan({ cls: 'evergreen-refactor-result-path', text: detail });
				}
			}

			el.addEventListener('click', () => this.toggle(choice));
			el.addEventListener('mouseenter', () => {
				if (this.activeIndex === index) return;
				this.activeIndex = index;
				this.renderResults();
			});
		});
	}

	private renderFooter(): void {
		this.footerEl.empty();
		const names = [...this.selected.values()].map((choice) =>
			choice.kind === 'create' ? choice.title : choice.file.basename,
		);

		const hint = this.footerEl.createDiv({ cls: 'evergreen-refactor-footer-hint' });
		if (this.options.mode === 'single') {
			hint.setText('Enter to reference it here · Esc to cancel');
			return;
		}
		if (names.length === 0) {
			hint.setText('Enter to add a note · ⌘/Ctrl+Enter to confirm · Esc to cancel');
			return;
		}

		hint.setText(`${names.length} selected: ${names.join(', ')}`);
		const button = this.footerEl.createEl('button', {
			cls: 'mod-cta',
			text: `Reference in ${names.length} note${names.length === 1 ? '' : 's'}`,
		});
		button.addEventListener('click', () => this.confirm());
	}

	override onClose(): void {
		super.onClose();
		this.contentEl.empty();
		if (this.settled) return;
		this.settled = true;
		this.resolver?.(this.confirmed ? [...this.selected.values()] : null);
		this.resolver = null;
	}
}

function keyOf(choice: DestinationChoice): string {
	return choice.kind === 'create' ? `create:${choice.path}` : `file:${choice.file.path}`;
}
