import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import babel from '@babel/core';
import esbuild from 'esbuild';

import typescriptSyntaxPlugin from '@babel/plugin-syntax-typescript';
import veDebugIdPlugin from '@vanilla-extract/babel-plugin-debug-ids';

import { RE_CSS_FILTER, getRandomId } from './utils.js';

/** @returns {esbuild.Plugin} */
export const transformPlugin = ({ debug }) => ({
	name: 'vanilla-extract-transform',
	setup (build) {
		const cwd = build.initialOptions.absWorkingDir;

		build.onLoad({ filter: RE_CSS_FILTER }, async (args) => {
			const { path: filename } = args;

			let source = await fs.readFile(filename, 'utf-8');
			let pathname = path.relative(cwd, filename);

			if (process.platform === 'win32') {
				pathname = path.posix.join(...pathname.split(path.sep));
			}

			if (debug) {
				const result = await babel.transformAsync(source, {
					filename: filename,
					cwd: cwd,
					plugins: [
						veDebugIdPlugin,
						typescriptSyntaxPlugin,
					],
				});

				if (!result || !result.code) {
					throw new Error(`Failed to add debug IDs`);
				}

				source = result.code;
			}

			const random = getRandomId();

			const code = `
import * as ${random} from "@vanilla-extract/css/fileScope";
${random}.setFileScope(${JSON.stringify(pathname)});
${source};
${random}.endFileScope();
`;

			return {
				loader: (/\.(ts|mts|tsx)$/i).test(filename) ? 'tsx' : 'jsx',
				contents: code,
			};
		});
	},
});
