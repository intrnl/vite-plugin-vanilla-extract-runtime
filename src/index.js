import * as path from 'node:path';

import hash from '@emotion/hash';
import * as esbuild from 'esbuild';
import MagicString from 'magic-string';

import { compileVanillaFile } from './integration/compile.js';
import { evaluateVanillaFile } from './integration/evaluate.js';
import { processVanillaFile } from './integration/process.js';
import { RE_CSS_FILTER, getRandomId } from './integration/utils.js';

const RE_OPT_START = /\b([a-zA-Z0-9_$]+)\(.+?\/\*__VE_RUNTIME_START__\*\//g;
const OPT_START = `/*__VE_RUNTIME_START__*/`;
const OPT_END = `/*__VE_RUNTIME_END__*/`;

/**
 * @returns {import('vite').Plugin}
 */
function vanillaExtractPlugin (options = {}) {
	let { outputCss = true, identifiers, esbuildOptions } = options;

	let prod = false;
	let cwd = '';

	const runtimeId = '\0ve-runtime';

	return {
		name: '@intrnl/vite-plugin-vanilla-extract-runtime',
		configResolved (config) {
			prod = config.isProduction;

			identifiers ||= prod ? 'short' : 'debug';
			cwd = config.root;
		},
		resolveId (id) {
			if (id === runtimeId) {
				return id;
			}

			return null;
		},
		async load (id, options) {
			const [properId] = id.split('?');

			if (properId === runtimeId) {
				if (prod) {
					return `
const injected = {};

export const inject = (map) => {
	let css = '';
	let id;

	for (const key in map) {
		if (key in injected) {
			continue;
		}

		if (!id) {
			id = key;
		}

		injected[key] = true;
		css += map[key];
	}

	if (!css) {
		return;
	}

	const style = document.createElement('style');
	style.id = 've' + id;
	style.textContent = css;

	document.head.appendChild(style);
};
`;
				}

				return `
export function inject (id, content) {
	let elementId = 've' + id;
	let style = document.getElementById(elementId);

	if (!style) {
		style = document.createElement('style');
		style.id = elementId;

		document.head.appendChild(style);
	}

	style.textContent = content;
}
`;
			}

			if (!RE_CSS_FILTER.test(properId) || properId[0] === '\0') {
				return null;
			}

			const dirname = path.dirname(properId);
			const filenameKey = hash.default(path.relative(cwd, properId));

			const { source, dependencies } = await compileVanillaFile({
				filename: properId,
				cwd,
				outputCss,
				esbuildOptions,
				identOption: identifiers,
			});

			const data = evaluateVanillaFile({ filename: properId, source });

			let { js, css } = processVanillaFile({
				filename: properId,
				cwd,
				data,
				serializeImport: (pathname, isEntry) => {
					if (isEntry) {
						return ``;
					}
					else {
						return `import ${JSON.stringify(relative(dirname, pathname))};`;
					}
				},
			});

			if (outputCss && !options.ssr) {
				if (prod) {
					const result = await esbuild.transform(css, {
						loader: 'css',
						minify: true,
					});

					css = result.code.trimEnd();

					if (css) {
						css = OPT_START + css + OPT_END;
					}
				}
				else {
					css += `\n/*# sourceURL=${properId}?css */`;
				}

				if (css) {
					const key = getRandomId();

					if (prod) {
						js = `
import * as ${key} from '${runtimeId}';
${js};
${key}.inject(${JSON.stringify(filenameKey + css)});
`;
					}
					else {
						js = `
import * as ${key} from '${runtimeId}';
${js};
${key}.inject(${JSON.stringify(filenameKey)}, ${JSON.stringify(css)});
`;
					}
				}
			}

			for (const file of dependencies) {
				this.addWatchFile(file);
			}

			return { code: js, moduleSideEffects: true };
		},
		renderChunk (code, chunk, opts) {
			if (!code.includes(OPT_START)) {
				return null;
			}

			// the reason why we added all that banner and footer is so that we can
			// concatenate them all here, to reduce the amount of times a style is
			// being appended to the DOM.

			// depending on the user's code, it could potentially be problematic if
			// there's anything like top-level await, the safer option seems to append
			// everything to the last call usage instead of moving everything to the
			// very end of the script.

			const str = new MagicString(code);
			const matches = Array.from(code.matchAll(RE_OPT_START));

			let sourcemap = null;
			let mapping = {};

			for (let idx = 0, len = matches.length; idx < len; idx++) {
				let match = matches[idx];

				let cssStart = match.index + match[0].length;
				let cssEnd = code.indexOf(OPT_END, cssStart);

				let stmtStart = match.index;
				let stmtEnd = cssEnd + OPT_END.length + 1;

				let idStart = code.lastIndexOf('(', cssStart) + 2;

				let quote = code[idStart - 1];

				let id = prefixId(code.slice(idStart, cssStart - OPT_START.length));
				let css = code.slice(cssStart, cssEnd);

				if (code[stmtEnd + 1] === ';') {
					stmtEnd++;
				}

				// we can't use the value as is if there's any attempts on escaping.
				if (css.includes('\\')) {
					if (quote === '"') {
						css = JSON.parse(quote + css + quote);
					}
					else {
						const ast = this.parse(quote + css + quote);
						const node = ast.body[0].expression;

						css = node.value;
					}
				}

				mapping[id] = css;
				str.remove(stmtStart, stmtEnd);
			}

			str.prependLeft(matches[0].index, `${matches[0][1]}(${JSON.stringify(mapping)});`);

			if (opts.sourcemap) {
				sourcemap = str.generateMap();
			}

			return { code: str.toString(), map: sourcemap };
		},
	};
}

export default vanillaExtractPlugin;

function relative (from, to) {
	let pathname = path.relative(from, to);

	if (pathname.slice(0, 3) !== '../') {
		pathname = './' + pathname;
	}

	return pathname;
}

/**
 * @param {string} id
 */
function prefixId (id) {
	const first = id.charCodeAt(0);
	return first >= 48 && first <= 57 ? '_' + id : id;
}
