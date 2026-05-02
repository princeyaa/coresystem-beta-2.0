const prisma = require('../lib/prisma');
const {
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const EVALUATION_TYPES = ['CC', 'PARTIEL', 'EXAMEN', 'RATTRAPAGE'];

const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    return res.redirect('/login');
};

function normalizeText(value, maxLength = 100) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeType(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return EVALUATION_TYPES.includes(value) ? value : 'all';
}

function normalizeSemester(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return normalizeText(value, 20);
}

function matchesSearch(grade, query) {
    if (!query) {
        return true;
    }

    const lowerQuery = query.toLowerCase();
    const course = grade.course || {};

    const searchableValues = [
        course.code,
        course.nom,
        course.semestre,
        grade.typeEvaluation,
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    return searchableValues.some((value) => value.includes(lowerQuery));
}

function groupNotesByCourse(grades, latestGradeAudits) {
    const grouped = new Map();

    grades.forEach((grade) => {
        const course = grade.course || {};
        const courseKey = course.id || 'unknown-course';
        const courseName = course.nom || 'Cours non défini';

        if (!grouped.has(courseKey)) {
            grouped.set(courseKey, {
                courseId: courseKey,
                courseCode: course.code || 'COURS',
                courseName,
                semestre: course.semestre || '-',
                credits: course.credits,
                coefficient: course.coefficient,
                notes: [],
            });
        }

        const trace = toTraceMeta(latestGradeAudits[grade.id], null);

        grouped.get(courseKey).notes.push({
            id: grade.id,
            type: grade.typeEvaluation,
            valeur: grade.valeur,
            published: grade.published,
            updatedAt: grade.updatedAt,
            trace,
        });
    });

    return Array.from(grouped.values()).sort((a, b) => {
        return a.courseName.localeCompare(b.courseName, 'fr');
    });
}

function calculateAverage(grades) {
    if (!grades.length) {
        return null;
    }

    const total = grades.reduce((sum, grade) => {
        return sum + Number(grade.valeur || 0);
    }, 0);

    return (total / grades.length).toFixed(2);
}

function calculateBestGrade(grades) {
    if (!grades.length) {
        return null;
    }

    return Math.max(...grades.map((grade) => Number(grade.valeur || 0))).toFixed(2);
}

const getNotes = async (req, res) => {
    try {
        const searchQuery = normalizeText(req.query.q);
        const selectedType = normalizeType(req.query.type);
        const selectedSemester = normalizeSemester(req.query.semestre);

        const student = await prisma.student.findUnique({
            where: {
                id: req.session.userId,
            },
            include: {
                enrollments: {
                    orderBy: {
                        createdAt: 'desc',
                    },
                    include: {
                        program: true,
                        class: {
                            include: {
                                campus: true,
                                department: true,
                            },
                        },
                    },
                },
            },
        });

        if (!student) {
            return res.redirect('/login');
        }

        const allPublishedGrades = await prisma.grade.findMany({
            where: {
                studentId: req.session.userId,
                published: true,
            },
            include: {
                course: {
                    include: {
                        program: true,
                    },
                },
            },
            orderBy: {
                updatedAt: 'desc',
            },
        });

        const availableSemesters = [
            ...new Set(
                allPublishedGrades
                    .map((grade) => grade.course && grade.course.semestre)
                    .filter(Boolean)
            ),
        ].sort();

        const filteredGrades = allPublishedGrades.filter((grade) => {
            const typeMatches =
                selectedType === 'all' || grade.typeEvaluation === selectedType;

            const semesterMatches =
                selectedSemester === 'all' ||
                (grade.course && grade.course.semestre === selectedSemester);

            return typeMatches && semesterMatches && matchesSearch(grade, searchQuery);
        });

        const latestGradeAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.GRADE,
            filteredGrades.map((grade) => grade.id)
        );

        const notesByCourse = groupNotesByCourse(filteredGrades, latestGradeAudits);

        const latestEnrollment =
            student.enrollments && student.enrollments.length
                ? student.enrollments[0]
                : null;

        return res.render('notes/index', {
            pageTitle: 'Mes notes',
            student,
            latestEnrollment,
            notesByCourse,
            filters: {
                q: searchQuery,
                type: selectedType,
                semestre: selectedSemester,
            },
            evaluationTypes: EVALUATION_TYPES,
            availableSemesters,
            stats: {
                allPublishedCount: allPublishedGrades.length,
                filteredCount: filteredGrades.length,
                courseCount: notesByCourse.length,
                average: calculateAverage(filteredGrades),
                bestGrade: calculateBestGrade(filteredGrades),
                lastUpdate: filteredGrades.length ? filteredGrades[0].updatedAt : null,
            },
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur lors du chargement des notes :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};

module.exports = {
    ensureAuthenticated,
    getNotes,
};