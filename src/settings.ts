import { type App, PluginSettingTab, Setting, TFolder, normalizePath } from 'obsidian';

import type EvergreenRefactorPlugin from './main.ts';
import { DISPLAY_MODE_LABELS, type ReferenceDisplayMode } from './types.ts';

export class EvergreenRefactorSettingTab extends PluginSettingTab {
	private readonly plugin: EvergreenRefactorPlugin;

	constructor(app: App, plugin: EvergreenRefactorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('References').setHeading();

		new Setting(containerEl)
			.setName('Reference display')
			.setDesc(
				'How a referenced passage appears in the notes you send it to. All three options point at the same block reference, so the original text is never copied.',
			)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(DISPLAY_MODE_LABELS)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings.displayMode);
				dropdown.onChange(async (value) => {
					this.plugin.settings.displayMode = value as ReferenceDisplayMode;
					await this.plugin.saveSettings();
					this.renderExamples();
				});
			});

		this.examplesEl = containerEl.createDiv({ cls: 'evergreen-refactor-examples' });
		this.renderExamples();

		new Setting(containerEl).setName('New notes').setHeading();

		new Setting(containerEl)
			.setName('Folder for new notes')
			.setDesc(
				'Where notes created from the destination picker are placed. Leave empty for the vault root, or use a folder path such as 20 Evergreen.',
			)
			.addText((text) => {
				text.setPlaceholder('Vault root');
				text.setValue(this.plugin.settings.newNoteFolder);
				text.onChange(async (value) => {
					this.plugin.settings.newNoteFolder = value.trim();
					await this.plugin.saveSettings();
				});
			});

		this.renderFolderHint(containerEl);
	}

	private examplesEl: HTMLElement | null = null;

	private renderExamples(): void {
		const el = this.examplesEl;
		if (!el) return;
		el.empty();

		const rows: Array<[ReferenceDisplayMode, string]> = [
			['embed', '![[2026.10.16#^20261016-164300-a7c9]]'],
			['link', '[[2026.10.16#^20261016-164300-a7c9|I keep noticing that…]]'],
			[
				'both',
				'[[2026.10.16#^20261016-164300-a7c9|I keep noticing that…]]\n![[2026.10.16#^20261016-164300-a7c9]]',
			],
		];

		for (const [mode, example] of rows) {
			const row = el.createDiv({ cls: 'evergreen-refactor-example' });
			row.toggleClass('is-active', this.plugin.settings.displayMode === mode);
			row.createDiv({ cls: 'evergreen-refactor-example-label', text: DISPLAY_MODE_LABELS[mode] });
			row.createEl('pre', { cls: 'evergreen-refactor-example-code', text: example });
		}
	}

	private renderFolderHint(containerEl: HTMLElement): void {
		const configured = this.plugin.settings.newNoteFolder;
		const normalized = configured.length === 0 ? '' : normalizePath(configured);
		const existing = normalized.length === 0 ? null : this.app.vault.getAbstractFileByPath(normalized);
		const isFolder = existing instanceof TFolder;

		const hint = containerEl.createDiv({ cls: 'evergreen-refactor-hint' });
		if (normalized.length === 0) {
			hint.setText('New notes are created in the vault root.');
			return;
		}
		if (existing === null) {
			hint.setText(`The folder “${normalized}” does not exist yet. It will be created the first time you use it.`);
			return;
		}
		if (!isFolder) {
			hint.setText(`“${normalized}” is an existing file, not a folder. Pick a different path.`);
			return;
		}
		hint.setText(`New notes are created in “${existing.path}”.`);
	}
}
