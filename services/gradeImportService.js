const { EvalType } = require('@prisma/client');
const prisma = require('../lib/prisma');

const MAX_IMPORT_ROWS = 3000;
const ALLOWED_EVAL_TYPES = Object.values(EvalType);

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeHeaderKey(value) {
    return normalizeText(String(value || ''))
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s_\-]/g, '')
        .toLowerCase();
}

function detectDelimiter(headerLine) {
    const commaCount = (headerLine.match(/,/g) || []).length;
    const semicolonCount = (headerLine.match(/;/g) || []).length;

    return semicolonCount > commaCount ? ';' : ',';
}

function parseCsvLine(line, delimiter) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i += 1;
                continue;
            }

            inQuotes = !inQuotes;
            continue;
        }

        if (char === delimiter && !inQuotes) {
            values.push(current);
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current);

    return values.map((value) => value.trim());
}

function parseCsvText(csvText) {
    const normalized = String(csvText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

    if (!normalized) {
        throw new Error('Veuillez coller un contenu CSV.');
    }

    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('Le CSV doit contenir une ligne d’en-tête et au moins une ligne de données.');
    }

    if (lines.length - 1 > MAX_IMPORT_ROWS) {
        throw new Error(`Le CSV dépasse la limite autorisée de ${MAX_IMPORT_ROWS} lignes.`);
    }

    const delimiter = detectDelimiter(lines[0]);
    const headers = parseCsvLine(lines[0], delimiter);

    return lines.slice(1).map((line, index) => {
        const values = parseCsvLine(line, delimiter);
        const rawRow = {};

        headers.forEach((header, headerIndex) => {
            rawRow[header] = values[headerIndex] || '';
        });

        return {
            rowNumber: index + 2,
            rawRow,
        };
    });
}

function getHeaderAliases() {
    return {
        matricule: ['matricule', 'studentmatricule'],
        courseCode: ['coursecode', 'codecours', 'courscode', 'course', 'cours'],
        typeEvaluation: ['typeevaluation', 'type', 'evaluationtype'],
        valeur: ['valeur', 'note', 'score'],
    };
}

function readCell(rawRow, aliases) {
    const normalizedRow = {};

    Object.entries(rawRow || {}).forEach(([key, value]) => {
        normalizedRow[normalizeHeaderKey(key)] = value;
    });

    for (const alias of aliases) {
        const normalizedAlias = normalizeHeaderKey(alias);

        if (Object.prototype.hasOwnProperty.call(normalizedRow, normalizedAlias)) {
            return normalizedRow[normalizedAlias];
        }
    }

    return '';
}

function sanitizeTypeEvaluation(value) {
    return normalizeText(value).toUpperCase();
}

function sanitizeGradeValue(value) {
    const normalized = normalizeText(value).replace(',', '.');

    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function mapRawGradeRow(parsedRow) {
    const aliases = getHeaderAliases();

    return {
        rowNumber: parsedRow.rowNumber,
        matricule: normalizeText(readCell(parsedRow.rawRow, aliases.matricule)),
        courseCode: normalizeText(readCell(parsedRow.rawRow, aliases.courseCode)).toUpperCase(),
        typeEvaluation: sanitizeTypeEvaluation(readCell(parsedRow.rawRow, aliases.typeEvaluation)),
        valeur: sanitizeGradeValue(readCell(parsedRow.rawRow, aliases.valeur)),
    };
}

function buildGradeKey(studentId, courseId, typeEvaluation) {
    return `${studentId}::${courseId}::${typeEvaluation}`;
}

async function getImportClassesForAdmin(admin) {
    const where =
        !admin || admin.role === 'SUPER_ADMIN'
            ? {}
            : {
                campusId: admin.campusId,
            };

    return prisma.academicClass.findMany({
        where,
        orderBy: [{ academicYear: 'desc' }, { nom: 'asc' }],
        include: {
            campus: true,
            department: true,
            program: true,
        },
    });
}

async function getScopedClassContext(admin, classId) {
    const where =
        !admin || admin.role === 'SUPER_ADMIN'
            ? { id: classId }
            : {
                id: classId,
                campusId: admin.campusId,
            };

    return prisma.academicClass.findFirst({
        where,
        include: {
            campus: true,
            department: true,
            program: true,
        },
    });
}

async function getGradeByIdWithRelations(id) {
    return prisma.grade.findUnique({
        where: { id },
        include: {
            student: {
                include: {
                    enrollments: {
                        orderBy: [{ createdAt: 'desc' }],
                        include: {
                            class: {
                                include: {
                                    campus: true,
                                    department: true,
                                },
                            },
                            program: true,
                        },
                    },
                },
            },
            course: {
                include: {
                    program: true,
                },
            },
        },
    });
}

function getStudentCampusId(grade) {
    if (
        !grade ||
        !grade.student ||
        !grade.student.enrollments ||
        !grade.student.enrollments.length
    ) {
        return null;
    }

    const enrollment = grade.student.enrollments[0];

    if (!enrollment.class || !enrollment.class.campus) {
        return null;
    }

    return enrollment.class.campus.id;
}

function buildGradeAuditSnapshot(grade) {
    if (!grade) return null;

    return {
        id: grade.id,
        studentId: grade.studentId,
        studentNom: grade.student ? `${grade.student.prenom} ${grade.student.nom}` : null,
        studentMatricule: grade.student ? grade.student.matricule : null,
        courseId: grade.courseId,
        courseCode: grade.course ? grade.course.code : null,
        courseNom: grade.course ? grade.course.nom : null,
        typeEvaluation: grade.typeEvaluation,
        valeur: grade.valeur,
        published: grade.published,
    };
}

async function buildGradeImportPreview({ admin, classId, csvContent }) {
    if (!classId) {
        throw new Error('Veuillez sélectionner une classe.');
    }

    const classContext = await getScopedClassContext(admin, classId);

    if (!classContext) {
        throw new Error('Classe introuvable ou hors de votre périmètre.');
    }

    const parsedRows = parseCsvText(csvContent);
    const mappedRows = parsedRows.map(mapRawGradeRow);

    const matricules = Array.from(
        new Set(mappedRows.map((row) => row.matricule).filter(Boolean))
    );

    const courseCodes = Array.from(
        new Set(mappedRows.map((row) => row.courseCode).filter(Boolean))
    );

    const [enrollments, courses] = await Promise.all([
        prisma.enrollment.findMany({
            where: {
                classId: classContext.id,
                academicYear: classContext.academicYear,
                student: {
                    matricule: {
                        in: matricules.length ? matricules : ['__none__'],
                    },
                },
            },
            include: {
                student: true,
                program: true,
                class: {
                    include: {
                        campus: true,
                        department: true,
                    },
                },
            },
        }),
        prisma.course.findMany({
            where: {
                code: {
                    in: courseCodes.length ? courseCodes : ['__none__'],
                },
                programId: classContext.programId,
            },
            include: {
                program: true,
            },
        }),
    ]);

    const enrollmentsByMatricule = new Map();
    enrollments.forEach((enrollment) => {
        enrollmentsByMatricule.set(enrollment.student.matricule, enrollment);
    });

    const coursesByCode = new Map();
    courses.forEach((course) => {
        coursesByCode.set(course.code.toUpperCase(), course);
    });

    const duplicateCounter = new Map();
    mappedRows.forEach((row) => {
        const key = `${row.matricule}::${row.courseCode}::${row.typeEvaluation}`;
        if (!row.matricule || !row.courseCode || !row.typeEvaluation) return;
        duplicateCounter.set(key, (duplicateCounter.get(key) || 0) + 1);
    });

    const validRows = [];
    const invalidRows = [];

    for (const row of mappedRows) {
        const errors = [];
        const warnings = [];

        if (!row.matricule) errors.push('Matricule obligatoire.');
        if (!row.courseCode) errors.push('Code cours obligatoire.');
        if (!row.typeEvaluation) errors.push('Type d’évaluation obligatoire.');
        if (row.valeur === null || Number.isNaN(row.valeur)) {
            errors.push('Valeur de note invalide.');
        }

        if (
            row.valeur !== null &&
            !Number.isNaN(row.valeur) &&
            (row.valeur < 0 || row.valeur > 20)
        ) {
            errors.push('La valeur doit être comprise entre 0 et 20.');
        }

        if (row.typeEvaluation && !ALLOWED_EVAL_TYPES.includes(row.typeEvaluation)) {
            errors.push('Type d’évaluation invalide.');
        }

        const duplicateKey = `${row.matricule}::${row.courseCode}::${row.typeEvaluation}`;
        if ((duplicateCounter.get(duplicateKey) || 0) > 1) {
            errors.push('Ligne dupliquée dans le CSV pour le même étudiant, cours et type.');
        }

        const enrollment = row.matricule
            ? enrollmentsByMatricule.get(row.matricule)
            : null;

        if (!enrollment) {
            errors.push(
                `Étudiant introuvable dans la classe ${classContext.nom} (${classContext.academicYear}).`
            );
        }

        const course = row.courseCode
            ? coursesByCode.get(row.courseCode)
            : null;

        if (!course) {
            errors.push(
                `Cours introuvable dans le programme de la classe ${classContext.nom}.`
            );
        }

        let existingGrade = null;

        if (enrollment && course && row.typeEvaluation && ALLOWED_EVAL_TYPES.includes(row.typeEvaluation)) {
            existingGrade = await prisma.grade.findFirst({
                where: {
                    studentId: enrollment.studentId,
                    courseId: course.id,
                    typeEvaluation: row.typeEvaluation,
                },
            });

            if (existingGrade && existingGrade.published) {
                errors.push(
                    'Cette note existe déjà et est publiée. Dépubliez-la avant un import massif.'
                );
            }
        }

        const display = {
            matricule: row.matricule || '—',
            studentNom: enrollment ? `${enrollment.student.prenom} ${enrollment.student.nom}` : '—',
            courseCode: row.courseCode || '—',
            courseNom: course ? course.nom : '—',
            typeEvaluation: row.typeEvaluation || '—',
            valeur:
                row.valeur === null || Number.isNaN(row.valeur)
                    ? '—'
                    : row.valeur,
            classLabel: classContext.nom,
            academicYear: classContext.academicYear,
        };

        if (errors.length) {
            invalidRows.push({
                rowNumber: row.rowNumber,
                matricule: row.matricule,
                courseCode: row.courseCode,
                typeEvaluation: row.typeEvaluation,
                valeur:
                    row.valeur === null || Number.isNaN(row.valeur)
                        ? null
                        : row.valeur,
                errors,
                warnings,
                display,
            });
            continue;
        }

        validRows.push({
            rowNumber: row.rowNumber,
            action: existingGrade ? 'update' : 'create',
            gradeData: {
                studentId: enrollment.studentId,
                courseId: course.id,
                typeEvaluation: row.typeEvaluation,
                valeur: row.valeur,
                published: false,
            },
            existingGradeId: existingGrade ? existingGrade.id : null,
            display,
            warnings,
        });
    }

    const createCount = validRows.filter((row) => row.action === 'create').length;
    const updateCount = validRows.filter((row) => row.action === 'update').length;
    const warningCount =
        validRows.reduce((sum, row) => sum + row.warnings.length, 0) +
        invalidRows.reduce((sum, row) => sum + row.warnings.length, 0);

    return {
        classContext,
        summary: {
            totalRows: mappedRows.length,
            validRows: validRows.length,
            invalidRows: invalidRows.length,
            createCount,
            updateCount,
            warningCount,
        },
        validRows,
        invalidRows,
        draft: {
            ownerAdminId: admin.id,
            ownerCampusId: admin.campusId || null,
            classId: classContext.id,
            generatedAt: new Date().toISOString(),
            summary: {
                totalRows: mappedRows.length,
                validRows: validRows.length,
                invalidRows: invalidRows.length,
                createCount,
                updateCount,
                warningCount,
            },
            validRows,
            invalidRows,
        },
    };
}

async function confirmGradeImport({ draft }) {
    if (!draft || !Array.isArray(draft.validRows)) {
        throw new Error('Aucun aperçu valide à confirmer.');
    }

    const rows = [];

    for (const row of draft.validRows) {
        try {
            if (row.action === 'create') {
                const createdGrade = await prisma.grade.create({
                    data: row.gradeData,
                });

                const fullGrade = await getGradeByIdWithRelations(createdGrade.id);

                rows.push({
                    status: 'created',
                    rowNumber: row.rowNumber,
                    gradeId: createdGrade.id,
                    display: row.display,
                    warnings: row.warnings || [],
                    beforeSnapshot: null,
                    afterSnapshot: buildGradeAuditSnapshot(fullGrade),
                    campusId: getStudentCampusId(fullGrade),
                });

                continue;
            }

            const beforeGrade = await getGradeByIdWithRelations(row.existingGradeId);

            const updatedGrade = await prisma.grade.update({
                where: { id: row.existingGradeId },
                data: {
                    valeur: row.gradeData.valeur,
                    published: false,
                },
            });

            const fullGrade = await getGradeByIdWithRelations(updatedGrade.id);

            rows.push({
                status: 'updated',
                rowNumber: row.rowNumber,
                gradeId: updatedGrade.id,
                display: row.display,
                warnings: row.warnings || [],
                beforeSnapshot: buildGradeAuditSnapshot(beforeGrade),
                afterSnapshot: buildGradeAuditSnapshot(fullGrade),
                campusId: getStudentCampusId(fullGrade),
            });
        } catch (error) {
            rows.push({
                status: 'rejected',
                rowNumber: row.rowNumber,
                gradeId: null,
                display: row.display,
                warnings: row.warnings || [],
                beforeSnapshot: null,
                afterSnapshot: null,
                campusId: null,
                error:
                    error && error.code === 'P2002'
                        ? 'Conflit de données détecté.'
                        : 'Erreur lors de l’écriture en base.',
            });
        }
    }

    return {
        generatedAt: draft.generatedAt,
        confirmedAt: new Date().toISOString(),
        classId: draft.classId,
        counts: {
            totalRows: draft.summary.totalRows,
            createdCount: rows.filter((row) => row.status === 'created').length,
            updatedCount: rows.filter((row) => row.status === 'updated').length,
            rejectedCount:
                draft.invalidRows.length +
                rows.filter((row) => row.status === 'rejected').length,
            warningCount:
                rows.reduce((sum, row) => sum + (row.warnings ? row.warnings.length : 0), 0) +
                draft.invalidRows.reduce((sum, row) => sum + (row.warnings ? row.warnings.length : 0), 0),
        },
        rows,
        invalidRows: draft.invalidRows,
    };
}

module.exports = {
    MAX_IMPORT_ROWS,
    ALLOWED_EVAL_TYPES,
    getImportClassesForAdmin,
    getScopedClassContext,
    buildGradeImportPreview,
    confirmGradeImport,
};