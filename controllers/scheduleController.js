const prisma = require('../lib/prisma');
const {
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const DAY_ORDER = {
    LUNDI: 1,
    MARDI: 2,
    MERCREDI: 3,
    JEUDI: 4,
    VENDREDI: 5,
    SAMEDI: 6,
};

const DAYS = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const STATUSES = ['NORMAL', 'MODIFIE', 'ANNULE'];

const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    return res.redirect('/login');
};

function normalizeText(value, maxLength = 100) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeDay(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return DAYS.includes(value) ? value : 'all';
}

function normalizeStatus(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return STATUSES.includes(value) ? value : 'all';
}

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

function matchesSearch(schedule, query) {
    if (!query) {
        return true;
    }

    const lowerQuery = query.toLowerCase();
    const course = schedule.course || {};

    const searchableValues = [
        course.code,
        course.nom,
        course.semestre,
        schedule.jour,
        schedule.salle,
        schedule.statut,
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    return searchableValues.some((value) => value.includes(lowerQuery));
}

function sortSchedules(schedules) {
    return schedules.sort((a, b) => {
        const dayCompare = (DAY_ORDER[a.jour] || 99) - (DAY_ORDER[b.jour] || 99);

        if (dayCompare !== 0) {
            return dayCompare;
        }

        return String(a.heureDebut || '').localeCompare(String(b.heureDebut || ''));
    });
}

function groupByDay(schedules, scheduleTraceMap) {
    const grouped = DAYS.map((day) => ({
        day,
        schedules: [],
    }));

    schedules.forEach((schedule) => {
        const target = grouped.find((item) => item.day === schedule.jour);

        if (target) {
            target.schedules.push({
                ...schedule,
                trace: scheduleTraceMap[schedule.id] || null,
            });
        }
    });

    return grouped;
}

function buildStats(allSchedules, filteredSchedules, todayEnum) {
    return {
        total: allSchedules.length,
        filtered: filteredSchedules.length,
        today: todayEnum
            ? allSchedules.filter((schedule) => schedule.jour === todayEnum).length
            : 0,
        modified: allSchedules.filter((schedule) => schedule.statut === 'MODIFIE').length,
        cancelled: allSchedules.filter((schedule) => schedule.statut === 'ANNULE').length,
    };
}

const getSchedule = async (req, res) => {
    try {
        const selectedDay = normalizeDay(req.query.day);
        const selectedStatus = normalizeStatus(req.query.status);
        const searchQuery = normalizeText(req.query.q);
        const todayEnum = getTodayEnum();

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

        const allSchedules = await prisma.schedule.findMany({
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
                course: {
                    include: {
                        program: true,
                    },
                },
            },
        });

        const sortedAllSchedules = sortSchedules(allSchedules);

        const filteredSchedules = sortedAllSchedules.filter((schedule) => {
            const dayMatches = selectedDay === 'all' || schedule.jour === selectedDay;
            const statusMatches =
                selectedStatus === 'all' || schedule.statut === selectedStatus;

            return dayMatches && statusMatches && matchesSearch(schedule, searchQuery);
        });

        const latestScheduleAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.SCHEDULE,
            filteredSchedules.map((schedule) => schedule.id)
        );

        const scheduleTraceMap = {};
        filteredSchedules.forEach((schedule) => {
            scheduleTraceMap[schedule.id] = toTraceMeta(
                latestScheduleAudits[schedule.id],
                {
                    label: 'Créneau enregistré',
                    summary: 'Créneau disponible',
                    actorName: 'Administration',
                    actorRole: 'ADMIN',
                    createdAt: schedule.updatedAt || schedule.createdAt,
                }
            );
        });

        const schedulesByDay = groupByDay(filteredSchedules, scheduleTraceMap);

        return res.render('schedule/index', {
            pageTitle: 'Mon emploi du temps',
            student,
            latestEnrollment,
            schedulesByDay,
            filters: {
                q: searchQuery,
                day: selectedDay,
                status: selectedStatus,
            },
            days: DAYS,
            statuses: STATUSES,
            todayEnum,
            stats: buildStats(sortedAllSchedules, filteredSchedules, todayEnum),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur lors du chargement de l’emploi du temps :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};

module.exports = {
    ensureAuthenticated,
    getSchedule,
};