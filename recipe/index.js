import { style } from '@vanilla-extract/css';

export const recipe = (options, debugId) => {
	const { base = '', variants, compoundVariants = [], defaultVariants = {} } = options;

	const baseClass = typeof base === 'string' ? base : style(base, debugId);
	const variantClasses = {};
	const compoundClasses = [];

	const compoundLength = compoundVariants.length;

	for (const key in variants) {
		const map = variants[key];

		variantClasses[key] = {};

		for (const selection in map) {
			const rule = map[selection];

			variantClasses[key][selection] = typeof rule === 'string'
				? rule
				: style(rule, debugId ? `${debugId}_${key}_${selection}` : `${key}_${selection}`);
		}
	}

	for (let idx = 0; idx < compoundLength; idx++) {
		const def = compoundVariants[idx];

		const matcher = def.variants;
		const rule = def.style;

		compoundClasses.push({
			variants: matcher,
			className: typeof rule === 'string'
				? rule
				: style(rule, debugId ? `${debugId}_compound_${idx}` : `compound_${idx}`),
		});
	}

	const builtFunction = buildRuntimeFunction({
		baseClass,
		variantClasses,
		compoundClasses,
		defaultVariants,
	});

	const evalFunction = (0, eval)(`(${builtFunction})`);
	evalFunction.__ve_intrnl_fn__serializer__ = true;

	return evalFunction;
};

const buildRuntimeFunction = (options) => {
	const { baseClass, variantClasses, compoundClasses, defaultVariants } = options;

	let keyIdx = 0;
	let result = '';

	const compoundLength = compoundClasses.length;

	const hasBaseClass = baseClass.length > 0;
	const hasVariants = Object.keys(variantClasses).length > 0;
	const hasDefaultVariants = hasVariants && Object.keys(defaultVariants).length > 0;
	const hasCompoundVariants = hasVariants && compoundLength > 0;

	const map = new Map();

	const concat = hasBaseClass
		? (str) => (JSON.stringify(' ' + str))
		: (str) => `(result ? " " : "") + ${JSON.stringify(str)}`;

	result += `(props${(hasDefaultVariants || hasCompoundVariants) ? ' = {}' : ''}) => {\n`;
	result += `  let result = ${JSON.stringify(baseClass)};\n`;

	if (hasVariants) {
		let consecutiveVariant = false;

		if (!hasDefaultVariants && !hasCompoundVariants) {
			result += `  if (!props) {\n`;
			result += `    return result;\n`;
			result += `  }\n`;
		}

		result += `  const {`;

		for (const key in variantClasses) {
			const str = `v${keyIdx++}`;

			map.set(key, str);

			result += `${consecutiveVariant ? `, ` : ``}${JSON.stringify(key)}: ${str}`;
			consecutiveVariant = true;

			if (key in defaultVariants) {
				result += ` = ${JSON.stringify(defaultVariants[key])}`;
			}
		}

		result += `} = ${(!hasDefaultVariants && !hasCompoundVariants) ? `(props || {})` : `props`};\n`;

		for (const key in variantClasses) {
			const mappedKey = map.get(key);
			const selections = variantClasses[key];

			let consecutive = false;

			for (const selection in selections) {
				const coercedSelection = JSON.stringify(coerceKey(selection));
				const className = selections[selection];

				if (!className) {
					continue;
				}

				result += `  ${consecutive ? `else ` : ''}if (${mappedKey} === ${coercedSelection}) {\n`;
				result += `    result += ${concat(className)};\n`;
				result += `  }\n`;

				consecutive = true;
			}
		}

		for (let idx = 0; idx < compoundLength; idx++) {
			const def = compoundClasses[idx];

			const matcher = def.variants;
			const className = def.className;

			let consecutive = false;

			if (!className) {
				continue;
			}

			result += `  if (`;

			for (const key in matcher) {
				const mappedKey = map.get(key);
				const selection = JSON.stringify(matcher[key]);

				result += `${consecutive ? ` && ` : ``}${mappedKey} === ${selection}`;
				consecutive = true;
			}

			if (!consecutive) {
				result += 'true';
			}

			result += `) {\n`;
			result += `    result += ${concat(className)};\n`;
			result += `  }\n`;
		}
	}

	result += `  return result;\n`;
	result += `}\n`;

	return result;
};

const coerceKey = (value) => {
	if (value === 'true' || value === 'false') {
		return value === 'true';
	}

	const num = Number(value);

	if (!Number.isNaN(num)) {
		return num;
	}

	return value;
};
