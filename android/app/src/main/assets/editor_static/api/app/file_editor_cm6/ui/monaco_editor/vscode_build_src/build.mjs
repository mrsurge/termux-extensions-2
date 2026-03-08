#!/usr/bin/env node
/**
 * TE2 Breadcrumbs Widget — esbuild bundler.
 *
 * Bundles the VS Code BreadcrumbsWidget + transitive deps from the
 * code-server worktree into a single browser-ready ESM file.
 *
 * Usage:
 *   node build.mjs
 *
 * Output:
 *   out/breadcrumbsWidget.js   (ESM, tree-shaken)
 *
 * Prerequisites:
 *   - code-server worktree at VSCODE_SRC (see below)
 *   - esbuild (resolved from local cache or npx)
 */

import { build } from '/data/data/com.termux/files/home/.npm/_npx/beb367dfa21eb3f5/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// VS Code source root (code-server worktree)
const VSCODE_SRC = path.resolve(__dirname, '../../../../../../mrselect6-2/code-server/lib/vscode/src');

const result = await build({
	entryPoints: [path.join(__dirname, 'breadcrumbs_entry.ts')],
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	outfile: path.join(__dirname, 'out/breadcrumbsWidget.js'),
	// Resolve bare "vs/..." imports from the VS Code source tree
	alias: {
		'vs': path.join(VSCODE_SRC, 'vs'),
	},
	// Handle .css imports (inline as text)
	loader: {
		'.css': 'css',
		'.ttf': 'dataurl',
		'.woff': 'dataurl',
		'.woff2': 'dataurl',
	},
	// Tree-shake aggressively
	treeShaking: true,
	minify: false,  // Keep readable for debugging; minify for prod later
	sourcemap: true,
	// VS Code uses .js extensions in imports but files are .ts
	resolveExtensions: ['.ts', '.js', '.mjs'],
	// Log what we built
	metafile: true,
	logLevel: 'info',
});

// Print bundle stats
if (result.metafile) {
	const outputs = result.metafile.outputs;
	for (const [outFile, info] of Object.entries(outputs)) {
		if (outFile.endsWith('.js')) {
			const kb = (info.bytes / 1024).toFixed(1);
			const inputCount = Object.keys(info.inputs).length;
			console.log(`\n✓ ${outFile}: ${kb} KB (${inputCount} source files bundled)`);
		}
	}
}
