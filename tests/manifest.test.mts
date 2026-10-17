import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const versions = JSON.parse(readFileSync(new URL('../versions.json', import.meta.url), 'utf8'));

describe('manifest.json', () => {
	it('uses an id Obsidian accepts', () => {
		assert.match(manifest.id, /^[a-z0-9-]+$/);
		assert.equal(manifest.id, 'evergreen-refactor');
	});

	it('stays in step with package.json', () => {
		assert.equal(manifest.version, pkg.version);
		assert.equal(manifest.name, 'Evergreen Refactor');
	});

	it('declares a minimum app version that has a matching versions.json entry', () => {
		assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/);
		assert.equal(versions[manifest.version], manifest.minAppVersion);
	});

	it('has everything the community plugin directory requires', () => {
		for (const field of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) {
			assert.equal(typeof manifest[field], 'string', `missing ${field}`);
			assert.ok(manifest[field].length > 0, `empty ${field}`);
		}
		assert.equal(typeof manifest.isDesktopOnly, 'boolean');
	});

	it('does not mention a local machine path', () => {
		assert.equal(JSON.stringify(manifest).includes('/Users/'), false);
	});
});

describe('package.json', () => {
	it('exposes the scripts the README documents', () => {
		for (const script of ['build', 'dev', 'test', 'typecheck', 'check', 'install:vault', 'dev:vault']) {
			assert.equal(typeof pkg.scripts[script], 'string', `missing script: ${script}`);
		}
	});

	it('is a private package so it can never be published to npm by accident', () => {
		assert.equal(pkg.private, true);
	});
});
