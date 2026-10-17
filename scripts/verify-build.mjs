#!/usr/bin/env node
/**
 * Smoke-test the built plugin without Obsidian.
 *
 * `tsc` proves the source type-checks and the tests prove the logic is right,
 * but neither proves that `main.js` is a CommonJS module Obsidian can load.
 * This does, by requiring it with a stubbed `obsidian` module.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function check(label, condition, detail = '') {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
		failures.push(label);
	}
}

console.log('Verifying build artifacts…\n');

for (const name of ['main.js', 'manifest.json', 'styles.css']) {
	check(`${name} exists`, existsSync(path.join(root, name)));
}

if (failures.length > 0) {
	console.error('\nRun `npm run build` first.');
	process.exit(1);
}

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
check('manifest id matches the plugin folder name', manifest.id === 'evergreen-refactor');
check('manifest version is semver', /^\d+\.\d+\.\d+$/.test(manifest.version));

const source = readFileSync(path.join(root, 'main.js'), 'utf8');
check('main.js does not bundle obsidian', !/require\(["']obsidian["']\)\s*;?\s*\n\s*var/.test(source));

const require_ = createRequire(import.meta.url);
const stub = new Proxy(
	{},
	{
		get: () => class Stub {},
	},
);

const module_ = { exports: {} };
try {
	const factory = new Function('module', 'exports', 'require', source);
	factory(module_, module_.exports, (id) => {
		if (id === 'obsidian' || id === 'electron') return stub;
		return require_(id);
	});
} catch (error) {
	check('main.js loads as CommonJS', false, String(error));
}

const Plugin = module_.exports?.default;
check(
	'main.js registers both command palette entries',
	source.includes('reference-selection-in-note') &&
		source.includes('reference-selection-in-notes'),
);
check(
	'main.js wires up the selection context menu',
	source.includes('editor-menu'),
);
check('main.js exports a plugin class by default', typeof Plugin === 'function');
check(
	'the plugin class implements onload',
	typeof Plugin?.prototype?.onload === 'function',
);

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed.`);
	process.exit(1);
}

console.log('\nAll build checks passed.');
