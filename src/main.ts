import { type App, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { Editor, MarkdownFileInfo, MarkdownView } from 'obsidian';

import { newBlockId } from './block-id.ts';
import { joinVaultPath, sanitizeNoteTitle } from './destination-path.ts';
import { DecisionModal, DestinationModal, type DestinationChoice } from './modals.ts';
import { buildReferenceLines, createPreview, unusableTargetReason } from './reference.ts';
import { type SelectionPlan, type SelectionRange, analyzeSelection } from './selection-plan.ts';
import { EvergreenRefactorSettingTab } from './settings.ts';
import {
	DEFAULT_SETTINGS,
	type EvergreenRefactorSettings,
	coerceSettings,
} from './types.ts';
import { appendReferenceBlock, missingReferences } from './writer.ts';
import type { Anchor } from './selection-plan.ts';

interface PreparedReference {
	anchor: Anchor;
	lines: string[];
}

interface WriteResult {
	created: number;
	updated: number;
	skipped: number;
	failed: number;
}

export default class EvergreenRefactorPlugin extends Plugin {
	settings: EvergreenRefactorSettings = { ...DEFAULT_SETTINGS };

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new EvergreenRefactorSettingTab(this.app, this));

		this.addCommand({
			id: 'reference-selection-in-note',
			name: 'Reference current selection…',
			editorCallback: (editor, ctx) => {
				void this.referenceSelection(editor, ctx);
			},
		});

		// The same action, in the same dropdown the selection context menu
		// already offers "Extract current selection" from. Highlighting text and
		// right-clicking is how this workflow is actually reached; the command
		// palette is the fallback for when there is no editor focused.
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, ctx) => {
				if (editor.getSelection().trim().length === 0) return;

				menu.addItem((item) =>
					item
						.setTitle('Reference current selection…')
						.setIcon('links-going-out')
						.setSection('selection')
						.onClick(() => {
							void this.referenceSelection(editor, ctx);
						}),
				);
			}),
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = coerceSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/* ---------------------------------------------------------------- */
	/* The one interaction                                               */
	/* ---------------------------------------------------------------- */

	private async referenceSelection(
		editor: Editor,
		ctx: MarkdownView | MarkdownFileInfo,
	): Promise<void> {
		const sourceFile = ctx.file;
		if (!sourceFile) {
			new Notice('Evergreen Refactor: open a note first.');
			return;
		}

		const selection: SelectionRange = {
			from: editor.getCursor('from'),
			to: editor.getCursor('to'),
		};
		const doc = editor.getValue();
		const makeId = (): string => newBlockId();

		let analysis = analyzeSelection(doc, selection, { makeId });

		if (analysis.status === 'decision') {
			const decision = await new DecisionModal(this.app, analysis.request).openAndWait();
			if (!decision) return;
			analysis = analyzeSelection(doc, selection, { makeId, decision });
		}

		if (analysis.status === 'unsupported') {
			new Notice(`Evergreen Refactor: ${analysis.reason}`);
			return;
		}
		if (analysis.status !== 'ready') {
			new Notice('Evergreen Refactor: could not work out how to reference that selection.');
			return;
		}

		const plan = analysis.plan;

		const target = sourceLinkTarget(this.app, sourceFile);
		const targetProblem = unusableTargetReason(target);
		if (targetProblem) {
			new Notice(`Evergreen Refactor: ${targetProblem}`);
			return;
		}

		const destinations = await new DestinationModal(this.app, {
			sourceFile,
			pathForNewNote: (title) => this.pathForNewNote(title),
		}).openAndWait();

		if (!destinations || destinations.length === 0) return;

		const prepared: PreparedReference[] = plan.units.map((unit) => ({
			anchor: unit.anchor,
			lines: buildReferenceLines(
				target,
				unit.anchor,
				createPreview(unit.text),
				this.settings.displayMode,
			),
		}));

		// Mark the passage as addressable *before* writing any links to it, so
		// the references are never briefly dangling. If the note changed while a
		// picker was open, the plan's line numbers no longer describe it.
		if (editor.getValue() !== doc) {
			new Notice(
				'Evergreen Refactor: this note changed while the picker was open, so nothing was written. Try again.',
			);
			return;
		}

		this.applyPlan(editor, plan);

		const result = await this.writeReferences(destinations, prepared);
		this.report(plan, result);
	}

	/**
	 * Apply edits bottom-up so the line numbers of edits further up the note
	 * stay valid. Undo history is preserved because this goes through the
	 * editor rather than rewriting the file behind the user's back.
	 */
	private applyPlan(editor: Editor, plan: SelectionPlan): void {
		if (plan.edits.length === 0) return;

		const lines = editor.getValue().split('\n');
		const sorted = [...plan.edits].sort(
			(a, b) => b.startLine - a.startLine || b.endLine - a.endLine,
		);

		for (const edit of sorted) {
			editor.replaceRange(
				edit.lines.join('\n'),
				{ line: edit.startLine, ch: 0 },
				{ line: edit.endLine, ch: (lines[edit.endLine] ?? '').length },
			);
		}
	}

	private async writeReferences(
		destinations: DestinationChoice[],
		prepared: PreparedReference[],
	): Promise<WriteResult> {
		const result: WriteResult = { created: 0, updated: 0, skipped: 0, failed: 0 };

		for (const choice of destinations) {
			try {
				if (choice.kind === 'create') {
					const path = normalizePath(choice.path);
					const existing = this.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						(await this.appendTo(existing, prepared)) ? (result.updated += 1) : (result.skipped += 1);
						continue;
					}
					await this.ensureFolder(path);
					await this.app.vault.create(
						path,
						appendReferenceBlock('', prepared.flatMap((entry) => entry.lines)),
					);
					result.created += 1;
					continue;
				}

				(await this.appendTo(choice.file, prepared))
					? (result.updated += 1)
					: (result.skipped += 1);
			} catch (error) {
				result.failed += 1;
				console.error('Evergreen Refactor: could not write a reference', error);
			}
		}

		return result;
	}

	/** Append the references that are not already present. */
	private async appendTo(file: TFile, prepared: PreparedReference[]): Promise<boolean> {
		let changed = false;

		await this.app.vault.process(file, (data) => {
			const missing = missingReferences(data, prepared);
			if (missing.length === 0) return data;
			changed = true;
			return appendReferenceBlock(
				data,
				missing.flatMap((entry) => entry.lines),
			);
		});

		return changed;
	}

	private async ensureFolder(filePath: string): Promise<void> {
		const folder = filePath.split('/').slice(0, -1).join('/');
		if (folder.length === 0) return;
		if (this.app.vault.getAbstractFileByPath(folder)) return;
		try {
			await this.app.vault.createFolder(folder);
		} catch {
			// Another writer got there first; the create below will still work.
		}
	}

	private pathForNewNote(title: string): string {
		const safe = sanitizeNoteTitle(title);
		const raw = this.settings.newNoteFolder.trim();
		const folder =
			raw.length === 0 ? '' : normalizePath(raw).replace(/^\/+|\/+$/g, '');
		return joinVaultPath(folder, safe.length > 0 ? safe : 'Untitled');
	}

	private report(plan: SelectionPlan, result: WriteResult): void {
		const parts: string[] = [];
		if (result.created > 0) {
			parts.push(`created ${result.created} note${result.created === 1 ? '' : 's'}`);
		}
		if (result.updated > 0) {
			parts.push(`referenced in ${result.updated} note${result.updated === 1 ? '' : 's'}`);
		}
		if (result.skipped > 0) {
			parts.push(`already referenced in ${result.skipped}`);
		}
		if (result.failed > 0) {
			parts.push(`failed for ${result.failed}`);
		}

		const message = [plan.summary, parts.length > 0 ? `${parts.join(', ')}.` : '']
			.filter((line) => line.length > 0)
			.concat(plan.warnings.map((warning) => `⚠ ${warning}`))
			.join('\n');

		new Notice(message, plan.warnings.length > 0 ? 9000 : 4000);
	}
}

/**
 * Use the shortest name Obsidian will resolve unambiguously. Only fall back to
 * the full path when two notes in the vault share a basename.
 */
export function sourceLinkTarget(app: App, file: TFile): string {
	const sameName = app.vault
		.getMarkdownFiles()
		.filter((other) => other.basename === file.basename);
	return sameName.length > 1 ? file.path.replace(/\.md$/i, '') : file.basename;
}
