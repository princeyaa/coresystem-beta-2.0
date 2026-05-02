const normalizeText = (value = '') => String(value).trim();

const normalizeUpper = (value = '') => normalizeText(value).toUpperCase();

const nullableText = (value = '') => {
    const text = normalizeText(value);
    return text || null;
};

const parseOptionalInt = (value) => {
    const raw = normalizeText(value);

    if (!raw) {
        return null;
    }

    return Number.parseInt(raw, 10);
};

const parseRequiredInt = (value) => {
    const raw = normalizeText(value);
    return Number.parseInt(raw, 10);
};

const parseRequiredFloat = (value) => {
    const raw = normalizeText(value);
    return Number.parseFloat(raw);
};

const isPositiveOrZeroInteger = (value) =>
    Number.isInteger(value) && value >= 0;

const isPositiveOrZeroNumber = (value) =>
    typeof value === 'number' && !Number.isNaN(value) && value >= 0;

module.exports = {
    normalizeText,
    normalizeUpper,
    nullableText,
    parseOptionalInt,
    parseRequiredInt,
    parseRequiredFloat,
    isPositiveOrZeroInteger,
    isPositiveOrZeroNumber,
};