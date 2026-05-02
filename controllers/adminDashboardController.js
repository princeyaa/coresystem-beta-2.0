const prisma = require('../lib/prisma');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
} = require('../middlewares/permissions');

const REQUEST_STATUSES = ['SOUMISE', 'EN_TRAITEMENT', 'TRAITEE', 'REJETEE'];

function buildCampusStudentWhere(campusId) {
    return {
        enrollments: {
            some: {
                class: {
                    campusId,
                },
            },
        },
    };
}

function buildCampusRequestWhere(campusId) {
    return {
        student: {
            enrollments: {
                some: {
                    class: {
                        campusId,
                    },
                },
            },
        },
    };
}

function buildCampusGradeWhere(campusId) {
    return {
        student: {
            enrollments: {
                some: {
                    class: {
                        campusId,
                    },
                },
            },
        },
    };
}

function buildCampusAssignmentWhere(campusId) {
    return {
        class: {
            campusId,
        },
    };
}

function labelRequestStatus(status) {
    const labels = {
        SOUMISE: 'Soumises',
        EN_TRAITEMENT: 'En traitement',
        TRAITEE: 'Traitées',
        REJETEE: 'Rejetées',
    };

    return labels[status] || status;
}

async function getRequestStatusChart(where = {}) {
    const rows = await prisma.request.groupBy({
        by: ['statut'],
        where,
        _count: {
            _all: true,
        },
    });

    const map = {};

    rows.forEach((row) => {
        map[row.statut] = row._count._all;
    });

    return REQUEST_STATUSES.map((status) => ({
        key: status,
        label: labelRequestStatus(status),
        value: map[status] || 0,
    }));
}

async function getGradePublicationChart(where = {}) {
    const [publishedCount, unpublishedCount] = await Promise.all([
        prisma.grade.count({
            where: {
                ...where,
                published: true,
            },
        }),
        prisma.grade.count({
            where: {
                ...where,
                published: false,
            },
        }),
    ]);

    return [
        {
            key: 'PUBLISHED',
            label: 'Publiées',
            value: publishedCount,
        },
        {
            key: 'UNPUBLISHED',
            label: 'Non publiées',
            value: unpublishedCount,
        },
    ];
}

async function getStudentCampusDistribution() {
    const campuses = await prisma.campus.findMany({
        orderBy: {
            nom: 'asc',
        },
        select: {
            id: true,
            nom: true,
        },
    });

    return Promise.all(
        campuses.map(async (campus) => ({
            key: campus.id,
            label: campus.nom,
            value: await prisma.student.count({
                where: buildCampusStudentWhere(campus.id),
            }),
        }))
    );
}

exports.getDashboard = async (req, res) => {
    try {
        const currentAdmin = await resolveCurrentAdmin(req);

        if (!currentAdmin || !currentAdmin.isActive) {
            req.session.destroy(() => {
                return res.redirect('/admin/login');
            });
            return;
        }

        const admin = await prisma.adminUser.findUnique({
            where: {
                id: currentAdmin.id,
            },
            include: {
                campus: true,
                department: true,
            },
        });

        if (!admin) {
            req.session.destroy(() => {
                return res.redirect('/admin/login');
            });
            return;
        }

        const globalAdmin = isGlobalAdmin(admin);

        if (globalAdmin) {
            const [
                campusCount,
                studentCount,
                professorCount,
                classCount,
                submittedRequestCount,
                unpublishedGradeCount,
                requestStatus,
                gradePublication,
                studentDistribution,
            ] = await Promise.all([
                prisma.campus.count(),
                prisma.student.count(),
                prisma.professor.count(),
                prisma.academicClass.count(),
                prisma.request.count({
                    where: {
                        statut: 'SOUMISE',
                    },
                }),
                prisma.grade.count({
                    where: {
                        published: false,
                    },
                }),
                getRequestStatusChart(),
                getGradePublicationChart(),
                getStudentCampusDistribution(),
            ]);

            return res.render('admin/dashboard', {
                pageTitle: 'Tableau de bord',
                admin,
                stats: {
                    campusCount,
                    studentCount,
                    professorCount,
                    classCount,
                    submittedRequestCount,
                    unpublishedGradeCount,
                },
                charts: {
                    requestStatus,
                    gradePublication,
                    studentDistribution,
                },
                session: req.session,
                configurationError: null,
            });
        }

        if (!admin.campusId) {
            return res.render('admin/dashboard', {
                pageTitle: 'Tableau de bord',
                admin,
                stats: {
                    studentCount: 0,
                    professorCount: 0,
                    classCount: 0,
                    assignmentCount: 0,
                    submittedRequestCount: 0,
                    unpublishedGradeCount: 0,
                },
                charts: {
                    requestStatus: [],
                    gradePublication: [],
                    studentDistribution: [],
                },
                session: req.session,
                configurationError:
                    'Compte ADMIN_CAMPUS sans campus. Contactez le SUPER_ADMIN.',
            });
        }

        const campusId = admin.campusId;
        const requestWhere = buildCampusRequestWhere(campusId);
        const gradeWhere = buildCampusGradeWhere(campusId);

        const [
            studentCount,
            professorCount,
            classCount,
            assignmentCount,
            submittedRequestCount,
            unpublishedGradeCount,
            requestStatus,
            gradePublication,
        ] = await Promise.all([
            prisma.student.count({
                where: buildCampusStudentWhere(campusId),
            }),
            prisma.professor.count({
                where: {
                    campusId,
                },
            }),
            prisma.academicClass.count({
                where: {
                    campusId,
                },
            }),
            prisma.teachingAssignment.count({
                where: buildCampusAssignmentWhere(campusId),
            }),
            prisma.request.count({
                where: {
                    ...requestWhere,
                    statut: 'SOUMISE',
                },
            }),
            prisma.grade.count({
                where: {
                    ...gradeWhere,
                    published: false,
                },
            }),
            getRequestStatusChart(requestWhere),
            getGradePublicationChart(gradeWhere),
        ]);

        return res.render('admin/dashboard', {
            pageTitle: 'Tableau de bord',
            admin,
            stats: {
                studentCount,
                professorCount,
                classCount,
                assignmentCount,
                submittedRequestCount,
                unpublishedGradeCount,
            },
            charts: {
                requestStatus,
                gradePublication,
                studentDistribution: [
                    {
                        key: campusId,
                        label: admin.campus ? admin.campus.nom : 'Campus',
                        value: studentCount,
                    },
                ],
            },
            session: req.session,
            configurationError: null,
        });
    } catch (error) {
        console.error('Erreur lors du chargement du dashboard admin :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};