import { type App, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { Editor, MarkdownFileInfo, MarkdownView } from 'obsidian';

import { newBlockId } from './block-id.ts';
import {
	type ReferenceSite,
	blockIdFromAnchor,
	findBlockIdAt,
	hasBlockIdDefinition,
	isValidBlockIdCandidate,
	parseWikiLink,
	renameBlockIdDefinition,
	rewriteLinkAnchors,
	sanitizeBlockIdInput,
} from './block-rename.ts';
import { joinVaultPath, sanitizeNoteTitle } from './destination-path.ts';
import {
	type DestinationChoice,
	DestinationModal,
	type DestinationMode,
	DecisionModal,
	PromptModal,
} from './modals.ts';
import { buildReferenceLines, createPreview, unusableTargetReason } from './reference.ts';
import { type SelectionPlan, type SelectionRange, analyzeSelection } from './selection-plan.ts';
import { EvergreenRefactorSettingTab } from './settings.ts';
import {
	DEFAULT_SETTINGS,
	type EvergreenRefactorSettings,
	coerceSettings,
} from './types.ts';
import { anchorPattern, appendReferenceBlock, missingReferences } from './writer.ts';
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
				void this.referenceSelection(editor, ctx, 'single');
			},
		});

		this.addCommand({
			id: 'reference-selection-in-notes',
			name: 'Reference current selection in several notes…',
			editorCallback: (editor, ctx) => {
				void this.referenceSelection(editor, ctx, 'multiple');
			},
		});

		this.addCommand({
			id: 'rename-block-id',
			name: 'Rename block ID at cursor…',
			editorCallback: (editor, ctx) => {
				void this.renameBlockId(editor, ctx);
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
							void this.referenceSelection(editor, ctx, 'single');
						}),
				);

				menu.addItem((item) =>
					item
						.setTitle('Reference current selection in several notes…')
						.setIcon('links-going-out')
						.setSection('selection')
						.onClick(() => {
							void this.referenceSelection(editor, ctx, 'multiple');
						}),
				);
			}),
		);

		// Renaming is a different kind of action, so it is offered separately and
		// only where it can actually apply: with the cursor inside a block that
		// carries an ID.
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, ctx) => {
				const target = findBlockIdAt(editor.getValue().split('\n'), editor.getCursor().line);
				if (!target) return;

				menu.addItem((item) =>
					item
						.setTitle('Rename block ID…')
						.setIcon('pencil-line')
						.setSection('selection')
						.onClick(() => {
							void this.renameBlockId(editor, ctx);
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
		mode: DestinationMode,
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
			mode,
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

	/* ---------------------------------------------------------------- */
	/* Renaming a block ID                                               */
	/* ---------------------------------------------------------------- */

	/**
	 * Rename a block ID and update every reference to it.
	 *
	 * This is the block-level version of Obsidian's "rename a note and update
	 * all its links". References are found through the metadata cache rather
	 * than by reading notes, so it is a lookup per file rather than a scan.
	 */
	private async renameBlockId(
		editor: Editor,
		ctx: MarkdownView | MarkdownFileInfo,
	): Promise<void> {
		const sourceFile = ctx.file;
		if (!sourceFile) {
			new Notice('Evergreen Refactor: open a note first.');
			return;
		}

		const doc = editor.getValue();
		const lines = doc.split('\n');
		const target = findBlockIdAt(lines, editor.getCursor().line);

		if (!target) {
			new Notice(
				'Evergreen Refactor: no block ID here. Put the cursor inside a block that has one, or on the ^id line beneath it.',
			);
			return;
		}

		const sites = this.collectReferenceSites(sourceFile, target.id);
		const siteCount = [...sites.values()].reduce((total, list) => total + list.length, 0);
		const noteCount = sites.size;

		const newId = await new PromptModal(this.app, {
			title: `Rename block ID ^${target.id}`,
			description:
				siteCount === 0
					? 'Nothing links to this block yet, so only this note changes.'
					: `This block is referenced in ${noteCount} note${noteCount === 1 ? '' : 's'} (${siteCount} link${siteCount === 1 ? '' : 's'}). Renaming will update every one of them.`,
			initialValue: target.id,
			placeholder: 'e.g. mom-rush',
			submitLabel: 'Rename',
			preview: (value) =>
				`[[${sourceLinkTarget(this.app, sourceFile)}#^${sanitizeBlockIdInput(value)}]]`,
			validate: (value) => {
				const clean = sanitizeBlockIdInput(value);
				if (clean.length === 0) {
					return 'Enter a block ID: letters, numbers and hyphens.';
				}
				if (!isValidBlockIdCandidate(clean)) {
					return 'Block IDs can only contain letters, numbers and hyphens.';
				}
				if (clean !== target.id && hasBlockIdDefinition(lines, clean)) {
					return `This note already has a ^${clean}. Pick a different ID.`;
				}
				return null;
			},
		}).openAndWait();

		if (!newId) return;

		const finalId = sanitizeBlockIdInput(newId);
		if (finalId === target.id) return;

		if (editor.getValue() !== doc) {
			new Notice(
				'Evergreen Refactor: this note changed while the prompt was open, so nothing was written. Try again.',
			);
			return;
		}

		// The source note is edited through the editor so the rename lands in the
		// undo history. References *within* it go through the editor too, or the
		// file write would clobber whatever has not been saved yet.
		const renamed = renameBlockIdDefinition(lines, target.id, finalId);
		const selfSites = sites.get(sourceFile.path) ?? [];
		const withSelfReferences = rewriteLinkAnchors(renamed.lines, selfSites, target.id, finalId);
		this.applyChangedLines(editor, lines, withSelfReferences.lines);

		let updatedNotes = 0;
		let updatedLinks = selfSites.length;

		for (const [path, fileSites] of sites) {
			if (path === sourceFile.path) continue;

			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			let replaced = 0;
			await this.app.vault.process(file, (data) => {
				const result = rewriteLinkAnchors(data.split('\n'), fileSites, target.id, finalId);
				replaced = result.replaced;
				return replaced === 0 ? data : result.lines.join('\n');
			});

			if (replaced > 0) {
				updatedNotes += 1;
				updatedLinks += replaced;
			}
		}

		new Notice(
			updatedLinks === 0
				? `Renamed ^${target.id} to ^${finalId}. Nothing referenced it yet.`
				: `Renamed ^${target.id} to ^${finalId}. Updated ${updatedLinks} reference${updatedLinks === 1 ? '' : 's'} in ${updatedNotes} note${updatedNotes === 1 ? '' : 's'}.`,
		);
	}

	/**
	 * Every link or embed in the vault whose anchor is `^id` and whose target
	 * resolves to `sourceFile`.
	 *
	 * Uses the metadata cache, which already records link positions, so no note
	 * has to be read to find them. The position is kept so the rewrite can be
	 * scoped to the link itself rather than pattern-matching the whole file.
	 */
	private collectReferenceSites(sourceFile: TFile, id: string): Map<string, ReferenceSite[]> {
		const pattern = anchorPattern({ kind: 'block', id });
		const sites = new Map<string, ReferenceSite[]>();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			const items = [...(cache.links ?? []), ...(cache.embeds ?? [])];

			for (const item of items) {
				const original = item.original;
				if (!original || !pattern.test(original)) continue;

				const parsed = parseWikiLink(original);
				if (!parsed || blockIdFromAnchor(parsed.anchor) !== id) continue;

				// The same block ID can exist in another note, so the target has to
				// resolve back to this one before the link counts.
				const dest =
					parsed.target.length === 0
						? file
						: this.app.metadataCache.getFirstLinkpathDest(parsed.target, file.path);
				if (!dest || dest.path !== sourceFile.path) continue;

				const list = sites.get(file.path) ?? [];
				list.push({ line: item.position.start.line, col: item.position.start.col });
				sites.set(file.path, list);
			}
		}

		return sites;
	}

	/** Replace only the lines that actually differ, bottom-up. */
	private applyChangedLines(editor: Editor, before: string[], after: string[]): void {
		const limit = Math.min(before.length, after.length);

		for (let i = limit - 1; i >= 0; i -= 1) {
			if (before[i] === after[i]) continue;
			editor.replaceRange(after[i], { line: i, ch: 0 }, { line: i, ch: before[i].length });
		}
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
