const prisma = require('../lib/prisma');
const {
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const PRIORITIES = ['NORMALE', 'IMPORTANTE', 'URGENTE'];
const SCOPES = ['all', 'general', 'targeted'];

const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    return res.redirect('/login');
};

function normalizeText(value, maxLength = 120) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizePriority(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return PRIORITIES.includes(value) ? value : 'all';
}

function normalizeScope(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return SCOPES.includes(value) ? value : 'all';
}

function matchesSearch(announcement, query) {
    if (!query) {
        return true;
    }

    const lowerQuery = query.toLowerCase();

    const searchableValues = [
        announcement.titre,
        announcement.contenu,
        announcement.priorite,
        announcement.program ? announcement.program.filiere : '',
        announcement.program ? announcement.program.niveau : '',
        announcement.author ? announcement.author.nom : '',
        announcement.author ? announcement.author.prenom : '',
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    return searchableValues.some((value) => value.includes(lowerQuery));
}

function buildStats(allAnnouncements, filteredAnnouncements) {
    return {
        total: allAnnouncements.length,
        filtered: filteredAnnouncements.length,
        general: allAnnouncements.filter((announcement) => !announcement.programId).length,
        targeted: allAnnouncements.filter((announcement) => announcement.programId).length,
        urgent: allAnnouncements.filter((announcement) => announcement.priorite === 'URGENTE').length,
        important: allAnnouncements.filter((announcement) => announcement.priorite === 'IMPORTANTE').length,
    };
}

async function getStudentContext(studentId) {
    return prisma.student.findUnique({
        where: {
            id: studentId,
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
}

const getAnnouncements = async (req, res) => {
    try {
        const searchQuery = normalizeText(req.query.q);
        const selectedPriority = normalizePriority(req.query.priority);
        const selectedScope = normalizeScope(req.query.scope);

        const student = await getStudentContext(req.session.userId);

        if (!student) {
            return res.redirect('/login');
        }

        const programIds = [
            ...new Set(
                student.enrollments
                    .map((enrollment) => enrollment.programId)
                    .filter(Boolean)
            ),
        ];

        const now = new Date();

        const allAnnouncements = await prisma.announcement.findMany({
            where: {
                AND: [
                    {
                        OR: [
                            { programId: null },
                            programIds.length
                                ? { programId: { in: programIds } }
                                : { id: '__NO_PROGRAM_ANNOUNCEMENT__' },
                        ],
                    },
                    {
                        OR: [
                            { expiresAt: null },
                            { expiresAt: { gt: now } },
                        ],
                    },
                ],
            },
            include: {
                author: true,
                program: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        const filteredAnnouncements = allAnnouncements.filter((announcement) => {
            const priorityMatches =
                selectedPriority === 'all' ||
                announcement.priorite === selectedPriority;

            const scopeMatches =
                selectedScope === 'all' ||
                (selectedScope === 'general' && !announcement.programId) ||
                (selectedScope === 'targeted' && announcement.programId);

            return priorityMatches && scopeMatches && matchesSearch(announcement, searchQuery);
        });

        const latestAnnouncementAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.ANNOUNCEMENT,
            filteredAnnouncements.map((announcement) => announcement.id)
        );

        const announcementsWithTrace = filteredAnnouncements.map((announcement) => {
            const auditTrace = toTraceMeta(
                latestAnnouncementAudits[announcement.id],
                null
            );

            return {
                ...announcement,
                traceMeta: auditTrace || {
                    label: 'Publié par',
                    summary: 'Annonce publiée',
                    actorName: announcement.author
                        ? `${announcement.author.prenom} ${announcement.author.nom}`
                        : 'Administration',
                    actorRole: announcement.author ? announcement.author.role : 'ADMIN',
                    createdAt: announcement.createdAt,
                },
            };
        });

        const latestEnrollment =
            student.enrollments && student.enrollments.length
                ? student.enrollments[0]
                : null;

        return res.render('announcements/index', {
            pageTitle: 'Annonces officielles',
            student,
            latestEnrollment,
            announcements: announcementsWithTrace,
            priorities: PRIORITIES,
            scopes: SCOPES,
            filters: {
                q: searchQuery,
                priority: selectedPriority,
                scope: selectedScope,
            },
            stats: buildStats(allAnnouncements, filteredAnnouncements),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur lors du chargement des annonces :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};

module.exports = {
    ensureAuthenticated,
    getAnnouncements,
};