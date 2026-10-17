import esbuild from 'esbuild';

const prod = process.argv[2] === 'production';

// `obsidian` and the CodeMirror packages are provided by the app at runtime and
// must never be bundled.
const external = [
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

const options = {
	entryPoints: ['src/main.ts'],
	bundle: true,
	external,
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
};

if (prod) {
	await esbuild.build(options);
} else {
	const context = await esbuild.context(options);
	await context.watch();
}
