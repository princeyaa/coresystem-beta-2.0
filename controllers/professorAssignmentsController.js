const prisma = require('../lib/prisma');
const { setFlash } = require('../utils/flash');
const {
    safeWriteAuditLog,
    getLatestAuditMap,
    getAuditHistory,
    toTraceMeta,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const EVALUATION_TYPES = ['CC', 'PARTIEL', 'EXAMEN', 'RATTRAPAGE'];

function buildGradeAuditSnapshot(grade, student, course) {
    if (!grade) return null;

    return {
        id: grade.id,
        studentId: grade.studentId,
        studentNom: student ? `${student.prenom} ${student.nom}` : null,
        courseId: grade.courseId,
        courseCode: course ? course.code : null,
        typeEvaluation: grade.typeEvaluation,
        valeur: grade.valeur,
        published: grade.published,
    };
}

async function getProfessorAssignmentOptions(professorId) {
    return prisma.teachingAssignment.findMany({
        where: { professorId },
        orderBy: [
            { academicYear: 'desc' },
            { createdAt: 'desc' },
        ],
        include: {
            course: {
                include: {
                    program: true,
                },
            },
            class: {
                include: {
                    campus: true,
                    department: true,
                    enrollments: true,
                },
            },
        },
    });
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSearchQuery(value) {
    return normalizeText(value).slice(0, 100);
}

function filterEnrollmentsByStudentQuery(enrollments = [], rawQuery = '') {
    const searchQuery = sanitizeSearchQuery(rawQuery);

    if (!searchQuery) {
        return {
            searchQuery: '',
            filteredEnrollments: enrollments,
        };
    }

    const terms = searchQuery
        .split(/\s+/)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 5);

    if (!terms.length) {
        return {
            searchQuery: '',
            filteredEnrollments: enrollments,
        };
    }

    const filteredEnrollments = enrollments.filter((enrollment) => {
        const student = enrollment.student || {};

        const haystack = [
            student.matricule || '',
            student.nom || '',
            student.prenom || '',
            `${student.prenom || ''} ${student.nom || ''}`,
            `${student.nom || ''} ${student.prenom || ''}`,
        ]
            .join(' ')
            .toLowerCase();

        return terms.every((term) => haystack.includes(term));
    });

    return {
        searchQuery,
        filteredEnrollments,
    };
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSearchQuery(value) {
    return normalizeText(value).slice(0, 100);
}

function buildProfessorAssignmentSearchWhere(rawQuery) {
    const searchQuery = sanitizeSearchQuery(rawQuery);

    if (!searchQuery) {
        return {
            searchQuery: '',
            searchWhere: {},
        };
    }

    const terms = searchQuery
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 5);

    if (!terms.length) {
        return {
            searchQuery: '',
            searchWhere: {},
        };
    }

    return {
        searchQuery,
        searchWhere: {
            AND: terms.map((term) => ({
                OR: [
                    { academicYear: { contains: term } },
                    {
                        course: {
                            is: {
                                code: { contains: term },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                program: {
                                    is: {
                                        filiere: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                program: {
                                    is: {
                                        niveau: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                code: { contains: term },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                campus: {
                                    is: {
                                        nom: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                department: {
                                    is: {
                                        nom: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                ],
            })),
        },
    };
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSearchQuery(value) {
    return normalizeText(value).slice(0, 100);
}

function filterEnrollmentsByStudentQuery(enrollments = [], rawQuery = '') {
    const searchQuery = sanitizeSearchQuery(rawQuery);

    if (!searchQuery) {
        return {
            searchQuery: '',
            filteredEnrollments: enrollments,
        };
    }

    const terms = searchQuery
        .split(/\s+/)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 5);

    if (!terms.length) {
        return {
            searchQuery: '',
            filteredEnrollments: enrollments,
        };
    }

    const filteredEnrollments = enrollments.filter((enrollment) => {
        const student = enrollment.student || {};

        const haystack = [
            student.matricule || '',
            student.nom || '',
            student.prenom || '',
            `${student.prenom || ''} ${student.nom || ''}`,
            `${student.nom || ''} ${student.prenom || ''}`,
        ]
            .join(' ')
            .toLowerCase();

        return terms.every((term) => haystack.includes(term));
    });

    return {
        searchQuery,
        filteredEnrollments,
    };
}
exports.index = async (req, res) => {
    try {
        const { searchQuery, searchWhere } = buildProfessorAssignmentSearchWhere(req.query.q);

        const professor = await prisma.professor.findUnique({
            where: { id: req.session.professorId },
        });

        if (!professor) {
            setFlash(req, 'error', 'Professeur introuvable.');
            return res.redirect('/professor/login');
        }

        const assignments = await prisma.teachingAssignment.findMany({
            where: {
                professorId: req.session.professorId,
                ...searchWhere,
            },
            orderBy: [
                { academicYear: 'desc' },
                { createdAt: 'desc' },
            ],
            include: {
                course: {
                    include: {
                        program: true,
                    },
                },
                class: {
                    include: {
                        campus: true,
                        department: true,
                        enrollments: true,
                    },
                },
            },
        });

        const assignmentIds = assignments.map((assignment) => assignment.id);
        const latestAssignmentAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            assignmentIds
        );

        const assignmentTraceMap = {};
        assignments.forEach((assignment) => {
            assignmentTraceMap[assignment.id] = toTraceMeta(
                latestAssignmentAudits[assignment.id],
                null
            );
        });

        return res.render('professor/assignments/index', {
            pageTitle: 'Mes affectations',
            assignments,
            assignmentTraceMap,
            evaluationTypes: EVALUATION_TYPES,
            searchQuery,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur liste affectations professeur :', error);
        return res.status(500).send('Erreur interne du serveur.');
    }
};

exports.show = async (req, res) => {
    try {
        const assignment = await prisma.teachingAssignment.findFirst({
            where: {
                id: req.params.id,
                professorId: req.session.professorId,
            },
            include: {
                professor: true,
                course: {
                    include: {
                        program: true,
                    },
                },
                class: {
                    include: {
                        campus: true,
                        department: true,
                        enrollments: {
                            orderBy: {
                                createdAt: 'desc',
                            },
                            include: {
                                student: true,
                                program: true,
                            },
                        },
                    },
                },
            },
        });

        if (!assignment) {
            setFlash(req, 'error', 'Affectation introuvable ou non autorisée.');
            return res.redirect('/professor/assignments');
        }

        const latestAssignmentAuditMap = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            [assignment.id]
        );

        const assignmentTraceMeta = toTraceMeta(
            latestAssignmentAuditMap[assignment.id],
            null
        );

        const assignmentTraceHistory = await getAuditHistory(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            assignment.id,
            { limit: 6 }
        );

        const totalEnrollments = assignment.class && assignment.class.enrollments
            ? assignment.class.enrollments.length
            : 0;

        const { searchQuery, filteredEnrollments } = filterEnrollmentsByStudentQuery(
            assignment.class && assignment.class.enrollments
                ? assignment.class.enrollments
                : [],
            req.query.q
        );

        return res.render('professor/assignments/show', {
            pageTitle: `Affectation - ${assignment.course.code}`,
            assignment,
            assignmentTraceMeta,
            assignmentTraceHistory,
            searchQuery,
            filteredEnrollments,
            totalEnrollments,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur détail affectation professeur :', error);
        return res.status(500).send('Erreur interne du serveur.');
    }
};

exports.getGradesForm = async (req, res) => {
    try {
        const selectedType = EVALUATION_TYPES.includes(req.query.type)
            ? req.query.type
            : 'CC';

        const [assignmentOptions, assignment] = await Promise.all([
            getProfessorAssignmentOptions(req.session.professorId),
            prisma.teachingAssignment.findFirst({
                where: {
                    id: req.params.id,
                    professorId: req.session.professorId,
                },
                include: {
                    course: {
                        include: {
                            program: true,
                        },
                    },
                    class: {
                        include: {
                            campus: true,
                            department: true,
                            enrollments: {
                                include: {
                                    student: true,
                                },
                            },
                        },
                    },
                    professor: true,
                },
            }),
        ]);

        if (!assignment) {
            setFlash(req, 'error', 'Affectation introuvable ou non autorisée.');
            return res.redirect('/professor/assignments');
        }

        if (!assignment.class) {
            setFlash(req, 'error', 'Cette affectation n’est liée à aucune classe.');
            return res.redirect('/professor/assignments');
        }

        const { searchQuery, filteredEnrollments } = filterEnrollmentsByStudentQuery(
            assignment.class.enrollments || [],
            req.query.q
        );

        const studentIds = filteredEnrollments.map((enrollment) => enrollment.studentId);

        const existingGrades = studentIds.length
            ? await prisma.grade.findMany({
                where: {
                    courseId: assignment.courseId,
                    studentId: { in: studentIds },
                    typeEvaluation: selectedType,
                },
            })
            : [];

        const gradesByStudentId = {};
        existingGrades.forEach((grade) => {
            gradesByStudentId[grade.studentId] = grade;
        });

        const gradeIds = existingGrades.map((grade) => grade.id);
        const latestGradeAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.GRADE,
            gradeIds
        );

        const gradeTraceByStudentId = {};
        existingGrades.forEach((grade) => {
            gradeTraceByStudentId[grade.studentId] = toTraceMeta(
                latestGradeAudits[grade.id],
                null
            );
        });

        const latestAssignmentAuditMap = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            [assignment.id]
        );

        const assignmentTraceMeta = toTraceMeta(
            latestAssignmentAuditMap[assignment.id],
            null
        );

        const assignmentTraceHistory = await getAuditHistory(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            assignment.id,
            { limit: 6 }
        );

        return res.render('professor/grades/form', {
            pageTitle: `Saisie des notes - ${assignment.course.code}`,
            assignment,
            assignmentOptions,
            evaluationTypes: EVALUATION_TYPES,
            selectedType,
            gradesByStudentId,
            gradeTraceByStudentId,
            assignmentTraceMeta,
            assignmentTraceHistory,
            searchQuery,
            displayedEnrollments: filteredEnrollments,
            totalEnrollments: assignment.class.enrollments.length,
        });
    } catch (error) {
        console.error('Erreur chargement saisie notes professeur :', error);
        return res.status(500).send('Erreur interne du serveur.');
    }
};

exports.saveGrades = async (req, res) => {
    try {
        const { typeEvaluation, grades } = req.body;

        if (!EVALUATION_TYPES.includes(typeEvaluation)) {
            setFlash(req, 'error', 'Type d’évaluation invalide.');
            return res.redirect(`/professor/assignments/${req.params.id}/grades`);
        }

        const assignment = await prisma.teachingAssignment.findFirst({
            where: {
                id: req.params.id,
                professorId: req.session.professorId,
            },
            include: {
                course: {
                    include: {
                        program: true,
                    },
                },
                class: {
                    include: {
                        campus: true,
                        department: true,
                        enrollments: {
                            include: {
                                student: true,
                            },
                        },
                    },
                },
            },
        });

        if (!assignment) {
            setFlash(req, 'error', 'Affectation introuvable ou non autorisée.');
            return res.redirect('/professor/assignments');
        }

        if (!assignment.class) {
            setFlash(req, 'error', 'Cette affectation n’est liée à aucune classe.');
            return res.redirect('/professor/assignments');
        }

        const existingGrades = await prisma.grade.findMany({
            where: {
                courseId: assignment.courseId,
                studentId: {
                    in: assignment.class.enrollments.map((enrollment) => enrollment.studentId),
                },
                typeEvaluation,
            },
        });

        const existingGradesByStudentId = {};
        existingGrades.forEach((grade) => {
            existingGradesByStudentId[grade.studentId] = grade;
        });

        for (const enrollment of assignment.class.enrollments) {
            const student = enrollment.student;
            const rawValue = grades ? grades[student.id] : undefined;

            if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
                continue;
            }

            const numericValue = Number(rawValue);

            if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 20) {
                setFlash(
                    req,
                    'error',
                    `La note de ${student.prenom} ${student.nom} doit être comprise entre 0 et 20.`
                );
                return res.redirect(`/professor/assignments/${req.params.id}/grades?type=${typeEvaluation}`);
            }

            const existingGrade = existingGradesByStudentId[student.id];

            if (existingGrade) {
                if (existingGrade.published) {
                    setFlash(
                        req,
                        'error',
                        `Note déjà publiée pour ${student.prenom} ${student.nom} (${typeEvaluation}). Impossible de modifier. Veuillez passer à l’administration.`
                    );
                    return res.redirect(`/professor/assignments/${req.params.id}/grades?type=${typeEvaluation}`);
                }

                const updatedGrade = await prisma.grade.update({
                    where: { id: existingGrade.id },
                    data: {
                        valeur: numericValue,
                        published: false,
                    },
                });

                await safeWriteAuditLog({
                    req,
                    entityType: AUDIT_ENTITY_TYPES.GRADE,
                    entityId: updatedGrade.id,
                    action: AUDIT_ACTIONS.UPDATE,
                    campusId: assignment.class.campus ? assignment.class.campus.id : null,
                    summary: `Modification professeur de la note ${typeEvaluation} pour ${student.prenom} ${student.nom}`,
                    beforeData: buildGradeAuditSnapshot(existingGrade, student, assignment.course),
                    afterData: buildGradeAuditSnapshot(updatedGrade, student, assignment.course),
                });

                continue;
            }

            const createdGrade = await prisma.grade.create({
                data: {
                    studentId: student.id,
                    courseId: assignment.courseId,
                    typeEvaluation,
                    valeur: numericValue,
                    published: false,
                },
            });

            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.GRADE,
                entityId: createdGrade.id,
                action: AUDIT_ACTIONS.CREATE,
                campusId: assignment.class.campus ? assignment.class.campus.id : null,
                summary: `Saisie professeur de la note ${typeEvaluation} pour ${student.prenom} ${student.nom}`,
                beforeData: null,
                afterData: buildGradeAuditSnapshot(createdGrade, student, assignment.course),
            });
        }

        setFlash(req, 'success', 'Les notes ont été enregistrées comme brouillon.');
        return res.redirect(`/professor/assignments/${req.params.id}/grades?type=${typeEvaluation}`);
    } catch (error) {
        console.error('Erreur enregistrement notes professeur :', error);
        return res.status(500).send('Erreur interne du serveur.');
    }
};