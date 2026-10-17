#!/usr/bin/env node
/**
 * Build the plugin and copy it into a vault's community-plugins folder.
 *
 * This script never guesses where your vault is. You must point it at one
 * explicitly, either with `--vault <path>` or the `OBSIDIAN_VAULT` environment
 * variable, and it refuses to write anywhere that does not look like a vault.
 * Nothing is ever deleted.
 *
 * Usage:
 *   node scripts/install.mjs --vault "/path/to/My Vault"
 *   node scripts/install.mjs --vault "/path/to/My Vault" --watch
 *   node scripts/install.mjs --vault "/path/to/My Vault" --dry-run
 *   node scripts/install.mjs --list
 */

import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ID = 'evergreen-refactor';

/** Files a manually installed Obsidian plugin needs. */
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const EXTERNAL = [
	'obsidian',
	'electron',
	'@codemirror/autocomplete',
	'@codemirror/collab',
	'@codemirror/commands',
	'@codemirror/language',
	'@codemirror/lint',
	'@codemirror/search',
	'@codemirror/state',
	'@codemirror/view',
	'@lezer/common',
	'@lezer/highlight',
	'@lezer/lr',
];

const args = process.argv.slice(2);
const readFlag = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const hasFlag = (name) => args.includes(name);

/**
 * Obsidian keeps a list of known vaults in a small JSON file. Reading it lets
 * us *show* the user their vaults without guessing, but it is never used to
 * write anything on its own.
 */
function detectedVaults() {
	const candidates = [
		path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
		path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json'),
		path.join(process.env.APPDATA ?? '', 'obsidian', 'obsidian.json'),
	];

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
			const vaults = Object.values(parsed.vaults ?? {})
				.map((entry) => entry?.path)
				.filter((value) => typeof value === 'string' && value.length > 0);
			if (vaults.length > 0) return { file: candidate, vaults };
		} catch {
			// Ignore a malformed file and try the next location.
		}
	}

	return null;
}

if (hasFlag('--help') || hasFlag('-h')) {
	console.log(
		[
			'Build Evergreen Refactor and copy it into an Obsidian vault.',
			'',
			'Usage:',
			`  node scripts/install.mjs --vault "/path/to/My Vault"`,
			`  node scripts/install.mjs --vault "/path/to/My Vault" --watch`,
			`  node scripts/install.mjs --vault "/path/to/My Vault" --dry-run`,
			'  node scripts/install.mjs --list',
			'',
			'Options:',
			'  --vault <path>   Vault root (the folder that contains .obsidian).',
			'                   Falls back to the OBSIDIAN_VAULT environment variable.',
			'  --watch          Rebuild and re-copy whenever src/ changes.',
			'  --dry-run        Show what would happen without writing anything.',
			'  --list           Print the vaults Obsidian has on this machine.',
			'  --skip-build     Copy the existing main.js without rebuilding it.',
			'',
			'Nothing is ever deleted, and your plugin settings are preserved.',
		].join('\n'),
	);
	process.exit(0);
}

if (hasFlag('--list')) {
	const found = detectedVaults();
	if (!found) {
		console.log('Could not find an Obsidian vault list on this machine.');
		console.log('In Obsidian: open the vault, then Settings → About → Vault path.');
		process.exit(0);
	}
	console.log(`Vaults listed in ${found.file}:\n`);
	for (const vault of found.vaults) console.log(`  ${vault}`);
	process.exit(0);
}

const vaultArg = readFlag('--vault') ?? process.env.OBSIDIAN_VAULT;
const watch = hasFlag('--watch');
const dryRun = hasFlag('--dry-run');
const skipBuild = hasFlag('--skip-build');

if (!vaultArg) {
	const found = detectedVaults();
	console.error(
		[
			'No vault given.',
			'',
			'Pass one explicitly, for example:',
			'  npm run install:vault -- --vault "/Users/you/Documents/My Vault"',
			'',
			'Or set it once:',
			'  export OBSIDIAN_VAULT="/Users/you/Documents/My Vault"',
			'',
			found
				? `Vaults Obsidian knows about on this machine:\n${found.vaults.map((v) => `  ${v}`).join('\n')}`
				: 'Run with --list to see the vaults Obsidian knows about.',
		].join('\n'),
	);
	process.exit(1);
}

const vault = path.resolve(vaultArg);
const obsidianDir = path.join(vault, '.obsidian');
const pluginDir = path.join(obsidianDir, 'plugins', PLUGIN_ID);

if (!existsSync(vault)) {
	console.error(`Vault path does not exist: ${vault}`);
	process.exit(1);
}

if (!existsSync(obsidianDir)) {
	console.error(
		[
			`No .obsidian folder in ${vault}.`,
			'',
			'That usually means this is not a vault. In Obsidian, open the vault you',
			'want and check Settings → About → Vault path (or use "Show vault in Finder").',
		].join('\n'),
	);
	process.exit(1);
}

const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));

console.log(`Vault:  ${vault}`);
console.log(`Target: ${pluginDir}`);
console.log(`Plugin: ${manifest.name} (${manifest.id}) v${manifest.version}`);
if (dryRun) console.log('Dry run: nothing will be written.');
console.log('');

async function copyArtifacts() {
	if (!dryRun) await mkdir(pluginDir, { recursive: true });

	for (const name of ARTIFACTS) {
		const from = path.join(projectRoot, name);
		if (!existsSync(from)) continue;
		if (!dryRun) await copyFile(from, path.join(pluginDir, name));
		console.log(`  ${dryRun ? 'would copy' : 'copied'} ${name}`);
	}
}

async function build() {
	await esbuild.build({
		entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
		bundle: true,
		external: EXTERNAL,
		format: 'cjs',
		target: 'es2018',
		logLevel: 'warning',
		treeShaking: true,
		outfile: path.join(projectRoot, 'main.js'),
		minify: true,
	});
}

async function buildAndCopy() {
	if (!skipBuild) await build();
	console.log(`[${new Date().toLocaleTimeString()}] built main.js`);
	await copyArtifacts();
}

if (watch) {
	await buildAndCopy();
	const context = await esbuild.context({
		entryPoints: [path.join(projectRoot, 'src', 'main.ts')],
		bundle: true,
		external: EXTERNAL,
		format: 'cjs',
		target: 'es2018',
		logLevel: 'warning',
		outfile: path.join(projectRoot, 'main.js'),
		minify: true,
		plugins: [
			{
				name: 'copy-to-vault',
				setup(build_) {
					build_.onEnd(async (result) => {
						if (result.errors.length > 0) return;
						console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
						await copyArtifacts();
						console.log('  → reload the plugin in Obsidian (see README)');
					});
				},
			},
		],
	});

	await context.watch();
	console.log('\nWatching src/ — press Ctrl+C to stop.');
} else {
	await buildAndCopy();
	console.log('\nDone. Now reload the plugin in Obsidian (see README).');
}
