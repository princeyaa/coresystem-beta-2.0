const prisma = require('../lib/prisma');

const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    return res.redirect('/login');
};

function normalizeText(value, maxLength = 120) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeSemester(value, availableSemesters) {
    if (!value || value === 'all') {
        return 'all';
    }

    return availableSemesters.includes(value) ? value : 'all';
}

function matchesSearch(course, query) {
    if (!query) {
        return true;
    }

    const lowerQuery = query.toLowerCase();

    const searchableValues = [
        course.code,
        course.nom,
        course.semestre,
        course.enseignant,
        course.program ? course.program.filiere : '',
        course.program ? course.program.niveau : '',
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    return searchableValues.some((value) => value.includes(lowerQuery));
}

function sortCourses(courses) {
    return courses.sort((a, b) => {
        const semesterCompare = String(a.semestre || '').localeCompare(
            String(b.semestre || ''),
            'fr'
        );

        if (semesterCompare !== 0) {
            return semesterCompare;
        }

        return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr');
    });
}

function buildStats(allCourses, filteredCourses) {
    const totalCredits = filteredCourses.reduce((sum, course) => {
        return sum + Number(course.credits || 0);
    }, 0);

    const totalCoefficient = filteredCourses.reduce((sum, course) => {
        return sum + Number(course.coefficient || 0);
    }, 0);

    const totalVolume = filteredCourses.reduce((sum, course) => {
        return sum + Number(course.volumeHoraire || 0);
    }, 0);

    const totalSchedules = filteredCourses.reduce((sum, course) => {
        return sum + (Array.isArray(course.schedules) ? course.schedules.length : 0);
    }, 0);

    return {
        totalCourses: allCourses.length,
        filteredCourses: filteredCourses.length,
        totalCredits,
        totalCoefficient,
        totalVolume,
        totalSchedules,
    };
}

function groupCoursesBySemester(courses) {
    const grouped = new Map();

    courses.forEach((course) => {
        const semester = course.semestre || 'Non défini';

        if (!grouped.has(semester)) {
            grouped.set(semester, []);
        }

        grouped.get(semester).push(course);
    });

    return Array.from(grouped.entries()).map(([semester, items]) => ({
        semester,
        courses: items,
    }));
}

const getCourses = async (req, res) => {
    try {
        const searchQuery = normalizeText(req.query.q);

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

        const latestEnrollment =
            student.enrollments && student.enrollments.length
                ? student.enrollments[0]
                : null;

        const programIds = [
            ...new Set(
                student.enrollments
                    .map((enrollment) => enrollment.programId)
                    .filter(Boolean)
            ),
        ];

        const allCourses = await prisma.course.findMany({
            where: programIds.length
                ? {
                    programId: {
                        in: programIds,
                    },
                }
                : {
                    id: '__NO_COURSE__',
                },
            include: {
                program: true,
                schedules: {
                    orderBy: [
                        {
                            jour: 'asc',
                        },
                        {
                            heureDebut: 'asc',
                        },
                    ],
                },
                teachingAssignments: {
                    include: {
                        professor: true,
                        class: true,
                    },
                },
            },
            orderBy: [
                {
                    semestre: 'asc',
                },
                {
                    nom: 'asc',
                },
            ],
        });

        const availableSemesters = [
            ...new Set(allCourses.map((course) => course.semestre).filter(Boolean)),
        ].sort();

        const selectedSemester = normalizeSemester(
            req.query.semestre,
            availableSemesters
        );

        const filteredCourses = sortCourses(
            allCourses.filter((course) => {
                const semesterMatches =
                    selectedSemester === 'all' || course.semestre === selectedSemester;

                return semesterMatches && matchesSearch(course, searchQuery);
            })
        );

        return res.render('courses/index', {
            pageTitle: 'Parcours / Matières',
            student,
            latestEnrollment,
            courses: filteredCourses,
            coursesBySemester: groupCoursesBySemester(filteredCourses),
            filters: {
                q: searchQuery,
                semestre: selectedSemester,
            },
            availableSemesters,
            stats: buildStats(allCourses, filteredCourses),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur lors du chargement des matières :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};

module.exports = {
    ensureAuthenticated,
    getCourses,
};