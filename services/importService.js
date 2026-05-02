const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const adminStudentService = require('./adminStudentService');
const { isGlobalAdmin } = require('../middlewares/permissions');

const MAX_IMPORT_ROWS = 3000;
const TEMP_PASSWORD_PREFIX = 'ST';

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || null;
}

function normalizePhone(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}

function normalizeHeaderKey(value) {
    return normalizeText(String(value || ''))
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s_\-]/g, '')
        .toLowerCase();
}

function buildProgramKey(filiere, niveau) {
    return `${normalizeText(filiere).toLowerCase()}::${normalizeText(niveau).toLowerCase()}`;
}

function buildClassCodeKey(code) {
    return normalizeText(code).toLowerCase();
}

function buildClassScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        campusId: admin.campusId,
    };
}

function buildStudentScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        enrollments: {
            some: {
                class: {
                    is: buildClassScopeWhere(admin),
                },
            },
        },
    };
}

function buildProgramScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        classes: {
            some: buildClassScopeWhere(admin),
        },
    };
}

function generateTemporaryPassword() {
    const partA = Math.random().toString(36).slice(2, 6);
    const partB = Date.now().toString(36).slice(-4);
    return `${TEMP_PASSWORD_PREFIX}-${partA}${partB}`;
}

function isValidEmail(email) {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    if (!phone) return true;

    const cleaned = phone.replace(/[^\d+]/g, '');
    const digitsOnly = cleaned.replace(/\D/g, '');

    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
        return false;
    }

    return /^[0-9+\s\-().]+$/.test(phone);
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
        matricule: ['matricule', 'numeroetudiant', 'numero_etudiant', 'numetudiant'],
        nom: ['nom', 'lastname', 'nomfamille', 'nomdefamille'],
        prenom: ['prenom', 'prénom', 'firstname'],
        email: ['email', 'mail', 'adresseemail'],
        telephone: ['telephone', 'téléphone', 'tel', 'numero', 'numéro', 'phone'],
        academicYear: [
            'academicyear',
            'anneeacademique',
            'annéeacademique',
            'anneeuniversitaire',
            'annéeuniversitaire',
            'annee',
            'année'
        ],
        filiere: [
            'filiere',
            'filière',
            'programfiliere',
            'programmefiliere',
            'program_filiere',
            'programme_filiere'
        ],
        niveau: [
            'niveau',
            'programniveau',
            'programmeniveau',
            'program_niveau',
            'programme_niveau'
        ],
        classCode: [
            'classcode',
            'codeclasse',
            'classecode',
            'classe',
            'class_code',
            'code_classe'
        ],
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

function mapRawStudentRow(parsedRow) {
    const aliases = getHeaderAliases();

    return {
        rowNumber: parsedRow.rowNumber,
        matricule: normalizeText(readCell(parsedRow.rawRow, aliases.matricule)),
        nom: normalizeText(readCell(parsedRow.rawRow, aliases.nom)),
        prenom: normalizeText(readCell(parsedRow.rawRow, aliases.prenom)),
        email: normalizeEmail(readCell(parsedRow.rawRow, aliases.email)),
        telephone: normalizePhone(readCell(parsedRow.rawRow, aliases.telephone)),
        academicYear: normalizeText(readCell(parsedRow.rawRow, aliases.academicYear)),
        filiere: normalizeText(readCell(parsedRow.rawRow, aliases.filiere)),
        niveau: normalizeText(readCell(parsedRow.rawRow, aliases.niveau)),
        classCode: normalizeText(readCell(parsedRow.rawRow, aliases.classCode)),
    };
}

async function buildReferenceData(admin) {
    const [programs, classes] = await Promise.all([
        adminStudentService.getProgramsForStudentForm(buildProgramScopeWhere(admin)),
        adminStudentService.getClassesForStudentForm(buildClassScopeWhere(admin)),
    ]);

    const programsByKey = new Map();
    const classesByCode = new Map();

    programs.forEach((program) => {
        programsByKey.set(
            buildProgramKey(program.filiere, program.niveau),
            program
        );
    });

    classes.forEach((academicClass) => {
        if (academicClass.code) {
            classesByCode.set(
                buildClassCodeKey(academicClass.code),
                academicClass
            );
        }
    });

    return {
        programsByKey,
        classesByCode,
    };
}

async function buildExistingStudentMaps(rows) {
    const matricules = Array.from(
        new Set(rows.map((row) => row.matricule).filter(Boolean))
    );

    const emails = Array.from(
        new Set(rows.map((row) => row.email).filter(Boolean))
    );

    const [studentsByMatricule, studentsByEmail] = await Promise.all([
        matricules.length
            ? prisma.student.findMany({
                where: {
                    matricule: { in: matricules },
                },
            })
            : [],
        emails.length
            ? prisma.student.findMany({
                where: {
                    email: { in: emails },
                },
            })
            : [],
    ]);

    const existingByMatricule = new Map();
    const existingByEmail = new Map();

    studentsByMatricule.forEach((student) => {
        existingByMatricule.set(student.matricule, student);
    });

    studentsByEmail.forEach((student) => {
        if (student.email) {
            existingByEmail.set(student.email, student);
        }
    });

    return {
        existingByMatricule,
        existingByEmail,
    };
}

function buildDuplicateCounter(rows, selector) {
    const map = new Map();

    rows.forEach((row) => {
        const key = selector(row);
        if (!key) return;

        map.set(key, (map.get(key) || 0) + 1);
    });

    return map;
}

function getCurrentEnrollment(studentRecord) {
    if (!studentRecord || !studentRecord.enrollments || !studentRecord.enrollments.length) {
        return null;
    }

    return studentRecord.enrollments[0];
}

function buildStudentAuditSnapshot(studentRecord) {
    if (!studentRecord) return null;

    const currentEnrollment = getCurrentEnrollment(studentRecord);

    return {
        id: studentRecord.id,
        matricule: studentRecord.matricule,
        nom: studentRecord.nom,
        prenom: studentRecord.prenom,
        email: studentRecord.email,
        telephone: studentRecord.telephone,
        currentEnrollment: currentEnrollment
            ? {
                id: currentEnrollment.id,
                academicYear: currentEnrollment.academicYear,
                programId: currentEnrollment.programId,
                classId: currentEnrollment.classId,
                programLabel: currentEnrollment.program
                    ? `${currentEnrollment.program.filiere} ${currentEnrollment.program.niveau}`
                    : null,
                classLabel: currentEnrollment.class
                    ? currentEnrollment.class.nom
                    : null,
                campusId:
                    currentEnrollment.class && currentEnrollment.class.campus
                        ? currentEnrollment.class.campus.id
                        : null,
                campusNom:
                    currentEnrollment.class && currentEnrollment.class.campus
                        ? currentEnrollment.class.campus.nom
                        : null,
            }
            : null,
    };
}

async function buildStudentImportPreview({ admin, csvContent }) {
    const parsedRows = parseCsvText(csvContent);
    const mappedRows = parsedRows.map(mapRawStudentRow);

    const { programsByKey, classesByCode } = await buildReferenceData(admin);
    const { existingByMatricule, existingByEmail } = await buildExistingStudentMaps(mappedRows);

    const matriculeDuplicates = buildDuplicateCounter(mappedRows, (row) => row.matricule);
    const emailDuplicates = buildDuplicateCounter(mappedRows, (row) => row.email);

    const validRows = [];
    const invalidRows = [];

    for (const row of mappedRows) {
        const errors = [];
        const warnings = [];

        if (!row.matricule) errors.push('Matricule obligatoire.');
        if (!row.nom) errors.push('Nom obligatoire.');
        if (!row.prenom) errors.push('Prénom obligatoire.');
        if (!row.academicYear) errors.push('Année académique obligatoire.');
        if (!row.filiere) errors.push('Filière obligatoire.');
        if (!row.niveau) errors.push('Niveau obligatoire.');
        if (!row.classCode) errors.push('Code classe obligatoire.');

        if (!row.email) {
            warnings.push('Email manquant.');
        }

        if (!row.telephone) {
            warnings.push('Téléphone manquant.');
        }

        if (row.email && !isValidEmail(row.email)) {
            errors.push('Format email invalide.');
        }

        if (row.telephone && !isValidPhone(row.telephone)) {
            errors.push('Format téléphone invalide.');
        }

        if (row.matricule && (matriculeDuplicates.get(row.matricule) || 0) > 1) {
            errors.push('Matricule dupliqué dans le CSV.');
        }

        if (row.email && (emailDuplicates.get(row.email) || 0) > 1) {
            errors.push('Email dupliqué dans le CSV.');
        }

        const program = programsByKey.get(buildProgramKey(row.filiere, row.niveau));
        const academicClass = classesByCode.get(buildClassCodeKey(row.classCode));

        if (!program) {
            errors.push('Programme introuvable dans votre périmètre.');
        }

        if (!academicClass) {
            errors.push('Classe introuvable dans votre périmètre.');
        }

        if (academicClass && program && academicClass.programId !== program.id) {
            errors.push('La classe ne correspond pas au programme indiqué.');
        }

        if (academicClass && row.academicYear && academicClass.academicYear !== row.academicYear) {
            errors.push('La classe ne correspond pas à l’année académique indiquée.');
        }

        const existingStudent = row.matricule
            ? existingByMatricule.get(row.matricule)
            : null;

        if (row.email) {
            const existingEmailStudent = existingByEmail.get(row.email);

            if (
                existingEmailStudent &&
                (!existingStudent || existingEmailStudent.id !== existingStudent.id)
            ) {
                errors.push('Cet email est déjà utilisé par un autre étudiant.');
            }
        }

        let scopedExistingStudent = null;
        let existingEnrollmentId = null;
        let beforeSnapshot = null;

        if (existingStudent) {
            scopedExistingStudent = await adminStudentService.getStudentById(
                existingStudent.id,
                buildStudentScopeWhere(admin)
            );

            if (!scopedExistingStudent) {
                errors.push('Un étudiant avec ce matricule existe déjà hors de votre périmètre.');
            } else {
                existingEnrollmentId =
                    scopedExistingStudent.enrollments && scopedExistingStudent.enrollments.length
                        ? scopedExistingStudent.enrollments[0].id
                        : null;

                beforeSnapshot = buildStudentAuditSnapshot(scopedExistingStudent);
            }
        }

        const display = {
            matricule: row.matricule,
            nomComplet: `${row.prenom} ${row.nom}`.trim(),
            email: row.email || '—',
            telephone: row.telephone || '—',
            academicYear: row.academicYear,
            programLabel: program ? `${program.filiere} ${program.niveau}` : `${row.filiere} ${row.niveau}`,
            classLabel: academicClass ? academicClass.nom : row.classCode,
            classCode: academicClass && academicClass.code ? academicClass.code : row.classCode,
            campusLabel: academicClass && academicClass.campus ? academicClass.campus.nom : '—',
        };

        if (errors.length) {
            invalidRows.push({
                rowNumber: row.rowNumber,
                matricule: row.matricule,
                nom: row.nom,
                prenom: row.prenom,
                email: row.email,
                telephone: row.telephone,
                academicYear: row.academicYear,
                filiere: row.filiere,
                niveau: row.niveau,
                classCode: row.classCode,
                errors,
                warnings,
            });
            continue;
        }

        validRows.push({
            rowNumber: row.rowNumber,
            action: existingStudent ? 'update' : 'create',
            studentData: {
                matricule: row.matricule,
                nom: row.nom,
                prenom: row.prenom,
                email: row.email,
                telephone: row.telephone,
            },
            enrollmentData: {
                academicYear: row.academicYear,
                programId: program.id,
                classId: academicClass.id,
            },
            existingStudentId: existingStudent ? existingStudent.id : null,
            existingEnrollmentId,
            beforeSnapshot,
            warnings,
            display,
        });
    }

    const createCount = validRows.filter((row) => row.action === 'create').length;
    const updateCount = validRows.filter((row) => row.action === 'update').length;
    const warningCount =
        validRows.reduce((total, row) => total + row.warnings.length, 0) +
        invalidRows.reduce((total, row) => total + row.warnings.length, 0);

    return {
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

async function confirmStudentImport({ draft }) {
    if (!draft || !Array.isArray(draft.validRows)) {
        throw new Error('Aucun aperçu valide à confirmer.');
    }

    const rows = [];

    for (const row of draft.validRows) {
        try {
            if (row.action === 'create') {
                const temporaryPassword = generateTemporaryPassword();
                const passwordHash = await bcrypt.hash(temporaryPassword, 10);

                const result = await adminStudentService.createStudentWithEnrollment({
                    studentData: {
                        ...row.studentData,
                        password: passwordHash,
                    },
                    enrollmentData: row.enrollmentData,
                });

                const studentRecord = await adminStudentService.getStudentById(result.student.id);

                rows.push({
                    status: 'created',
                    rowNumber: row.rowNumber,
                    matricule: row.studentData.matricule,
                    nomComplet: `${row.studentData.prenom} ${row.studentData.nom}`,
                    studentId: result.student.id,
                    temporaryPassword,
                    beforeSnapshot: null,
                    afterSnapshot: buildStudentAuditSnapshot(studentRecord),
                    warnings: row.warnings || [],
                    display: row.display,
                });

                continue;
            }

            const result = await adminStudentService.updateStudentWithEnrollment({
                studentId: row.existingStudentId,
                studentData: row.studentData,
                enrollmentData: row.enrollmentData,
                existingEnrollmentId: row.existingEnrollmentId,
            });

            const studentRecord = await adminStudentService.getStudentById(result.student.id);

            rows.push({
                status: 'updated',
                rowNumber: row.rowNumber,
                matricule: row.studentData.matricule,
                nomComplet: `${row.studentData.prenom} ${row.studentData.nom}`,
                studentId: result.student.id,
                temporaryPassword: null,
                beforeSnapshot: row.beforeSnapshot || null,
                afterSnapshot: buildStudentAuditSnapshot(studentRecord),
                warnings: row.warnings || [],
                display: row.display,
            });
        } catch (error) {
            rows.push({
                status: 'rejected',
                rowNumber: row.rowNumber,
                matricule: row.studentData.matricule,
                nomComplet: `${row.studentData.prenom} ${row.studentData.nom}`,
                studentId: null,
                temporaryPassword: null,
                beforeSnapshot: row.beforeSnapshot || null,
                afterSnapshot: null,
                warnings: row.warnings || [],
                display: row.display,
                error:
                    error && error.code === 'P2002'
                        ? 'Conflit de données détecté.'
                        : 'Erreur lors de l’écriture en base.',
            });
        }
    }

    const createdCount = rows.filter((row) => row.status === 'created').length;
    const updatedCount = rows.filter((row) => row.status === 'updated').length;
    const rejectedCount =
        draft.invalidRows.length +
        rows.filter((row) => row.status === 'rejected').length;

    const warningCount =
        rows.reduce((total, row) => total + (row.warnings ? row.warnings.length : 0), 0) +
        draft.invalidRows.reduce((total, row) => total + (row.warnings ? row.warnings.length : 0), 0);

    return {
        generatedAt: draft.generatedAt,
        confirmedAt: new Date().toISOString(),
        counts: {
            totalRows: draft.summary.totalRows,
            createdCount,
            updatedCount,
            rejectedCount,
            warningCount,
        },
        rows,
        invalidRows: draft.invalidRows,
    };
}

module.exports = {
    MAX_IMPORT_ROWS,
    buildStudentImportPreview,
    confirmStudentImport,
};