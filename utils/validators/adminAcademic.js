const {
    normalizeText,
    normalizeUpper,
    nullableText,
    parseOptionalInt,
    parseRequiredInt,
    parseRequiredFloat,
    isPositiveOrZeroInteger,
    isPositiveOrZeroNumber,
} = require('./common');

const ALLOWED_REGIMES = ['annuel', 'semestriel'];

const sanitizeProgramInput = (body = {}) => {
    return {
        filiere: normalizeText(body.filiere),
        niveau: normalizeUpper(body.niveau),
        faculte: nullableText(body.faculte),
        regime: ALLOWED_REGIMES.includes(body.regime) ? body.regime : 'annuel',
    };
};

const buildProgramForm = (program = {}) => ({
    filiere: program.filiere || '',
    niveau: program.niveau || '',
    faculte: program.faculte || '',
    regime: program.regime || 'annuel',
});

const validateProgramData = (programData) => {
    if (!programData.filiere || !programData.niveau) {
        return 'La filière et le niveau sont obligatoires.';
    }

    if (!ALLOWED_REGIMES.includes(programData.regime)) {
        return 'Le régime sélectionné est invalide.';
    }

    return null;
};

const sanitizeCourseInput = (body = {}) => {
    return {
        code: normalizeUpper(body.code),
        nom: normalizeText(body.nom),
        semestre: normalizeUpper(body.semestre),
        volumeHoraire: parseOptionalInt(body.volumeHoraire),
        credits: parseRequiredInt(body.credits),
        coefficient: parseRequiredFloat(body.coefficient),
        enseignant: nullableText(body.enseignant),
        programId: normalizeText(body.programId),
    };
};

const buildCourseForm = (course = {}) => ({
    code: course.code || '',
    nom: course.nom || '',
    semestre: course.semestre || '',
    volumeHoraire:
        typeof course.volumeHoraire === 'number' ? course.volumeHoraire : '',
    credits: typeof course.credits === 'number' ? course.credits : '',
    coefficient:
        typeof course.coefficient === 'number' ? course.coefficient : '',
    enseignant: course.enseignant || '',
    programId: course.programId || '',
});

const validateCourseData = (courseData) => {
    if (
        !courseData.code ||
        !courseData.nom ||
        !courseData.semestre ||
        !courseData.programId
    ) {
        return 'Le code, le nom, le semestre et le programme sont obligatoires.';
    }

    if (!isPositiveOrZeroInteger(courseData.credits)) {
        return 'Les crédits doivent être un nombre entier valide.';
    }

    if (!isPositiveOrZeroNumber(courseData.coefficient)) {
        return 'Le coefficient doit être un nombre valide.';
    }

    if (
        courseData.volumeHoraire !== null &&
        !isPositiveOrZeroInteger(courseData.volumeHoraire)
    ) {
        return 'Le volume horaire doit être vide ou être un entier valide.';
    }

    return null;
};

module.exports = {
    ALLOWED_REGIMES,
    sanitizeProgramInput,
    buildProgramForm,
    validateProgramData,
    sanitizeCourseInput,
    buildCourseForm,
    validateCourseData,
};