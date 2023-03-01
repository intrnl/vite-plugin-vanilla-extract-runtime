import * as path from 'node:path';

import { transformCss } from '@vanilla-extract/css/transformCss';

import hash from '@emotion/hash';
import { stringify } from 'javascript-stringify';

export function processVanillaFile (options) {
	const { filename, cwd = process.cwd(), data, serializeImport } = options;
	const { cssByFileScope, localClassNames, composedClassLists, usedCompositions, cssExports } = data;

	const unusedCompositions = composedClassLists
		.filter(({ identifier }) => !usedCompositions.has(identifier))
		.map(({ identifier }) => identifier);

	const unusedCompositionRegex = unusedCompositions.length > 0
		? RegExp(`(${unusedCompositions.join('|')})\\s`, 'g')
		: null;

	const cssImports = [];
	let css = '';

	for (const [relname, sources] of cssByFileScope) {
		const pathname = path.join(cwd, relname);
		const isEntry = pathname === filename;

		if (isEntry) {
			css = transformCss({
				localClassNames: Array.from(localClassNames),
				composedClassLists: composedClassLists,
				cssObjs: sources,
			}).join('\n');
		}

		const imports = serializeImport(pathname, isEntry);

		if (imports) {
			cssImports.push(imports);
		}
	}

	const js = serializeVanillaModule(cssImports, cssExports, unusedCompositionRegex);

	return { js, css };
}

function serializeVanillaModule (cssImports, cssExports, unusedCompositionRegex) {
	const functionSerializationImports = new Set();

	const defaultExportName = '_' + Math.random().toString(36).slice(2, 8);

	const exportLookup = new Map(
		Object.entries(cssExports).map(([key, value]) => [value, key === 'default' ? defaultExportName : key]),
	);

	const moduleExports = Object.keys(cssExports).map((key) => {
		const serializedExport = stringifyExports(
			functionSerializationImports,
			cssExports[key],
			unusedCompositionRegex,
			key === 'default' ? defaultExportName : key,
			exportLookup,
		);

		if (key === 'default') {
			return (
				`var ${defaultExportName} = ${serializedExport};\n`
				+ `export default ${defaultExportName};`
			);
		}

		return `export var ${key} = ${serializedExport};`;
	});

	const outputCode = [
		...cssImports,
		...functionSerializationImports,
		...moduleExports,
	];

	return outputCode.join('\n');
}

function stringifyExports (functionSerializationImports, value, unusedCompositionRegex, key, exportLookup) {
	const options = {
		references: true,
		maxDepth: Infinity,
		maxValues: Infinity,
	};

	return stringify(
		value,
		(value, _indent, next) => {
			const valueType = typeof value;

			if (valueType === 'boolean' || valueType === 'number' || valueType === 'undefined' || value === null) {
				return next(value);
			}

			if (Array.isArray(value) || isPlainObject(value)) {
				const reusedExport = exportLookup.get(value);
				if (reusedExport && reusedExport !== key) {
					return reusedExport;
				}
				return next(value);
			}

			if (Symbol.toStringTag in Object(value)) {
				const { [Symbol.toStringTag]: _tag, ...valueWithoutTag } = value;

				return next(valueWithoutTag);
			}

			if (valueType === 'string') {
				const replacement = unusedCompositionRegex ? value.replace(unusedCompositionRegex, '') : value;

				return next(
					replacement,
				);
			}

			if (valueType === 'function' && (value.__function_serializer__ || value.__recipe__)) {
				const { importPath, importName, args } = value.__function_serializer__ || value.__recipe__;

				if (typeof importPath !== 'string' || typeof importName !== 'string' || !Array.isArray(args)) {
					throw new Error('Invalid function serialization params');
				}

				try {
					const hashedImportName = `_${hash.default(`${importName}${importPath}`).slice(0, 5)}`;

					const serializedArgs = args.map(
						(arg) => stringifyExports(functionSerializationImports, arg, unusedCompositionRegex, key, exportLookup),
					);

					functionSerializationImports.add(
						`import { ${importName} as ${hashedImportName} } from '${importPath}';`,
					);

					return `${hashedImportName}(${serializedArgs.join(',')})`;
				}
				catch (err) {
					console.error(err);
					throw new Error('Invalid function serialization params');
				}
			}
			throw new Error(
				`Invalid exports.\nYou can only export plain objects, arrays, strings, numbers and null/undefined.`,
			);
		},
		0,
		options,
	);
}

function isPlainObject (o) {
	if (!hasObjectPrototype(o)) {
		return false;
	}

	const ctor = o.constructor;
	if (typeof ctor === 'undefined') {
		return true;
	}

	const prot = ctor.prototype;
	if (!hasObjectPrototype(prot)) {
		return false;
	}

	if (!prot.hasOwnProperty('isPrototypeOf')) {
		return false;
	}

	return true;
}

function hasObjectPrototype (o) {
	return Object.prototype.toString.call(o) === '[object Object]';
}
