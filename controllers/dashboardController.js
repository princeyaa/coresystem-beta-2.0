// src/controllers/dashboardController.js
const prisma = require('../lib/prisma');

/**
 * Middleware de protection : redirige vers /login si aucune session étudiant
 */
exports.ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    return res.redirect('/login');
};

function getTodayEnum() {
    const day = new Date().getDay();

    const map = {
        1: 'LUNDI',
        2: 'MARDI',
        3: 'MERCREDI',
        4: 'JEUDI',
        5: 'VENDREDI',
        6: 'SAMEDI',
    };

    return map[day] || null;
}

function getLatestEnrollment(student) {
    if (!student || !student.enrollments || !student.enrollments.length) {
        return null;
    }

    return student.enrollments[0];
}

/**
 * Affiche le tableau de bord étudiant
 */
exports.getDashboard = async (req, res) => {
    try {
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

        const latestEnrollment = getLatestEnrollment(student);

        const programIds = [
            ...new Set(
                student.enrollments
                    .map((enrollment) => enrollment.programId)
                    .filter(Boolean)
            ),
        ];

        const todayEnum = getTodayEnum();

        const [
            recentGrades,
            totalPublishedGrades,
            recentRequests,
            totalRequests,
            pendingRequests,
            recentAnnouncements,
            upcomingSchedules,
            todaySchedules,
        ] = await Promise.all([
            prisma.grade.findMany({
                where: {
                    studentId: student.id,
                    published: true,
                },
                include: {
                    course: true,
                },
                orderBy: {
                    updatedAt: 'desc',
                },
                take: 5,
            }),

            prisma.grade.count({
                where: {
                    studentId: student.id,
                    published: true,
                },
            }),

            prisma.request.findMany({
                where: {
                    studentId: student.id,
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: 5,
            }),

            prisma.request.count({
                where: {
                    studentId: student.id,
                },
            }),

            prisma.request.count({
                where: {
                    studentId: student.id,
                    statut: {
                        in: ['SOUMISE', 'EN_TRAITEMENT'],
                    },
                },
            }),

            prisma.announcement.findMany({
                where: {
                    AND: [
                        {
                            OR: [
                                { programId: null },
                                programIds.length
                                    ? { programId: { in: programIds } }
                                    : { id: '__NO_PROGRAM__' },
                            ],
                        },
                        {
                            OR: [
                                { expiresAt: null },
                                { expiresAt: { gt: new Date() } },
                            ],
                        },
                    ],
                },
                include: {
                    program: true,
                    author: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: 5,
            }),

            prisma.schedule.findMany({
                where: programIds.length
                    ? {
                        course: {
                            programId: {
                                in: programIds,
                            },
                        },
                    }
                    : {
                        id: '__NO_SCHEDULE__',
                    },
                include: {
                    course: true,
                },
                orderBy: [
                    { jour: 'asc' },
                    { heureDebut: 'asc' },
                ],
                take: 8,
            }),

            todayEnum
                ? prisma.schedule.findMany({
                    where: programIds.length
                        ? {
                            jour: todayEnum,
                            course: {
                                programId: {
                                    in: programIds,
                                },
                            },
                        }
                        : {
                            id: '__NO_SCHEDULE__',
                        },
                    include: {
                        course: true,
                    },
                    orderBy: {
                        heureDebut: 'asc',
                    },
                    take: 5,
                })
                : Promise.resolve([]),
        ]);

        const dashboardStats = {
            enrollmentsCount: student.enrollments.length,
            publishedGradesCount: totalPublishedGrades,
            requestsCount: totalRequests,
            pendingRequestsCount: pendingRequests,
            announcementsCount: recentAnnouncements.length,
            todaySchedulesCount: todaySchedules.length,
        };

        return res.render('dashboard/index', {
            pageTitle: 'Dashboard étudiant',
            student,
            latestEnrollment,
            recentGrades,
            recentRequests,
            recentAnnouncements,
            upcomingSchedules,
            todaySchedules,
            dashboardStats,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur lors du chargement du tableau de bord étudiant :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};