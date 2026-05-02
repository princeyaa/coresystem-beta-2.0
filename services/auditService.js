const prisma = require('../lib/prisma');
const { getCurrentActorType } = require('../middlewares/auth');

const AUDIT_ACTOR_TYPES = Object.freeze({
    ADMIN: 'ADMIN',
    PROFESSOR: 'PROFESSOR',
    STUDENT: 'STUDENT',
    SYSTEM: 'SYSTEM',
});

const AUDIT_ACTIONS = Object.freeze({
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    RESET_PASSWORD: 'RESET_PASSWORD',
    ACTIVATE: 'ACTIVATE',
    DEACTIVATE: 'DEACTIVATE',
    PUBLISH: 'PUBLISH',
    UNPUBLISH: 'UNPUBLISH',
    STATUS_CHANGE: 'STATUS_CHANGE',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
});

const AUDIT_ENTITY_TYPES = Object.freeze({
    ADMIN_USER: 'ADMIN_USER',
    STUDENT: 'STUDENT',
    PROFESSOR: 'PROFESSOR',
    TEACHING_ASSIGNMENT: 'TEACHING_ASSIGNMENT',
    GRADE: 'GRADE',
    REQUEST: 'REQUEST',
    ANNOUNCEMENT: 'ANNOUNCEMENT',
    ACADEMIC_CLASS: 'ACADEMIC_CLASS',
    PROGRAM: 'PROGRAM',
    COURSE: 'COURSE',
    SCHEDULE: 'SCHEDULE',
    CAMPUS: 'CAMPUS',
    DEPARTMENT: 'DEPARTMENT',
    AUTH_SESSION: 'AUTH_SESSION',
});

const SENSITIVE_KEYS = new Set([
    'password',
    'passwordHash',
    'motDePasse',
]);

function sanitizeAuditValue(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeAuditValue(item));
    }

    if (typeof value === 'object') {
        const cleanObject = {};

        Object.entries(value).forEach(([key, nestedValue]) => {
            if (SENSITIVE_KEYS.has(key)) {
                cleanObject[key] = '[REDACTED]';
                return;
            }

            cleanObject[key] = sanitizeAuditValue(nestedValue);
        });

        return cleanObject;
    }

    return value;
}

async function resolveAdminActor(req) {
    if (req && req.currentAdmin) {
        return {
            actorType: AUDIT_ACTOR_TYPES.ADMIN,
            actorId: req.currentAdmin.id,
            actorName: `${req.currentAdmin.prenom} ${req.currentAdmin.nom}`,
            actorRole: req.currentAdmin.role || 'ADMIN',
            campusId: req.currentAdmin.campusId || null,
        };
    }

    if (!req || !req.session || !req.session.adminId) {
        return null;
    }

    const admin = await prisma.adminUser.findUnique({
        where: { id: req.session.adminId },
        select: {
            id: true,
            nom: true,
            prenom: true,
            role: true,
            campusId: true,
        },
    });

    if (!admin) {
        return null;
    }

    return {
        actorType: AUDIT_ACTOR_TYPES.ADMIN,
        actorId: admin.id,
        actorName: `${admin.prenom} ${admin.nom}`,
        actorRole: admin.role || 'ADMIN',
        campusId: admin.campusId || null,
    };
}

async function resolveProfessorActor(req) {
    if (!req || !req.session || !req.session.professorId) {
        return null;
    }

    const professor = await prisma.professor.findUnique({
        where: { id: req.session.professorId },
        select: {
            id: true,
            nom: true,
            prenom: true,
            campusId: true,
        },
    });

    if (!professor) {
        return null;
    }

    return {
        actorType: AUDIT_ACTOR_TYPES.PROFESSOR,
        actorId: professor.id,
        actorName: `${professor.prenom} ${professor.nom}`,
        actorRole: 'PROFESSOR',
        campusId: professor.campusId || null,
    };
}

async function resolveStudentActor(req) {
    if (!req || !req.session || !req.session.userId) {
        return null;
    }

    const student = await prisma.student.findUnique({
        where: { id: req.session.userId },
        select: {
            id: true,
            nom: true,
            prenom: true,
            enrollments: {
                take: 1,
                orderBy: {
                    createdAt: 'desc',
                },
                select: {
                    class: {
                        select: {
                            campusId: true,
                        },
                    },
                },
            },
        },
    });

    if (!student) {
        return null;
    }

    const latestEnrollment = student.enrollments[0] || null;

    return {
        actorType: AUDIT_ACTOR_TYPES.STUDENT,
        actorId: student.id,
        actorName: `${student.prenom} ${student.nom}`,
        actorRole: 'STUDENT',
        campusId: latestEnrollment && latestEnrollment.class
            ? latestEnrollment.class.campusId
            : null,
    };
}

async function resolveAuditActor(req) {
    const actorType = getCurrentActorType(req ? req.session : null);

    if (actorType === 'admin') {
        const actor = await resolveAdminActor(req);
        if (actor) return actor;
    }

    if (actorType === 'professor') {
        const actor = await resolveProfessorActor(req);
        if (actor) return actor;
    }

    if (actorType === 'student') {
        const actor = await resolveStudentActor(req);
        if (actor) return actor;
    }

    return {
        actorType: AUDIT_ACTOR_TYPES.SYSTEM,
        actorId: null,
        actorName: 'Système',
        actorRole: 'SYSTEM',
        campusId: null,
    };
}

async function writeAuditLog({
    req = null,
    actor = null,
    entityType,
    entityId = null,
    action,
    summary,
    campusId = null,
    beforeData = null,
    afterData = null,
}) {
    if (!entityType) {
        throw new Error('entityType est obligatoire pour écrire un audit log.');
    }

    if (!action) {
        throw new Error('action est obligatoire pour écrire un audit log.');
    }

    if (!summary) {
        throw new Error('summary est obligatoire pour écrire un audit log.');
    }

    const resolvedActor = actor || await resolveAuditActor(req);

    return prisma.auditLog.create({
        data: {
            entityType,
            entityId: entityId || null,
            action,
            actorType: resolvedActor.actorType || AUDIT_ACTOR_TYPES.SYSTEM,
            actorId: resolvedActor.actorId || null,
            actorName: (resolvedActor.actorName || 'Système').slice(0, 191),
            actorRole: resolvedActor.actorRole || null,
            campusId: campusId || resolvedActor.campusId || null,
            summary: String(summary).slice(0, 255),
            beforeData: sanitizeAuditValue(beforeData),
            afterData: sanitizeAuditValue(afterData),
        },
    });
}

async function safeWriteAuditLog(options) {
    try {
        return await writeAuditLog(options);
    } catch (error) {
        console.error('Erreur écriture audit log :', error);
        return null;
    }
}

function normalizeEntityIds(entityIds = []) {
    return [...new Set(
        entityIds
            .filter(Boolean)
            .map((value) => String(value))
    )];
}

function traceLabelForAction(action) {
    switch (action) {
        case AUDIT_ACTIONS.CREATE:
            return 'Créé par';
        case AUDIT_ACTIONS.UPDATE:
            return 'Modifié par';
        case AUDIT_ACTIONS.DELETE:
            return 'Supprimé par';
        case AUDIT_ACTIONS.RESET_PASSWORD:
            return 'Mot de passe réinitialisé par';
        case AUDIT_ACTIONS.ACTIVATE:
            return 'Réactivé par';
        case AUDIT_ACTIONS.DEACTIVATE:
            return 'Désactivé par';
        case AUDIT_ACTIONS.PUBLISH:
            return 'Publié par';
        case AUDIT_ACTIONS.UNPUBLISH:
            return 'Dépublié par';
        case AUDIT_ACTIONS.STATUS_CHANGE:
            return 'Statut changé par';
        case AUDIT_ACTIONS.LOGIN:
            return 'Connexion par';
        case AUDIT_ACTIONS.LOGOUT:
            return 'Déconnexion par';
        default:
            return 'Dernière action par';
    }
}

function toTraceMeta(audit, fallback = null) {
    if (!audit) {
        return fallback;
    }

    return {
        label: traceLabelForAction(audit.action),
        summary: audit.summary,
        actorName: audit.actorName,
        actorRole: audit.actorRole,
        action: audit.action,
        createdAt: audit.createdAt,
    };
}

async function getLatestAuditMap(entityType, entityIds = [], options = {}) {
    const ids = normalizeEntityIds(entityIds);

    if (!entityType || ids.length === 0) {
        return {};
    }

    const where = {
        entityType,
        entityId: {
            in: ids,
        },
    };

    if (options.actions && options.actions.length) {
        where.action = {
            in: options.actions,
        };
    }

    const audits = await prisma.auditLog.findMany({
        where,
        orderBy: {
            createdAt: 'desc',
        },
    });

    const map = {};

    audits.forEach((audit) => {
        if (!map[audit.entityId]) {
            map[audit.entityId] = audit;
        }
    });

    return map;
}

async function getAuditHistory(entityType, entityId, options = {}) {
    if (!entityType || !entityId) {
        return [];
    }

    const where = {
        entityType,
        entityId: String(entityId),
    };

    if (options.actions && options.actions.length) {
        where.action = {
            in: options.actions,
        };
    }

    return prisma.auditLog.findMany({
        where,
        orderBy: {
            createdAt: 'desc',
        },
        take: options.limit || 5,
    });
}

module.exports = {
    AUDIT_ACTOR_TYPES,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
    sanitizeAuditValue,
    resolveAuditActor,
    writeAuditLog,
    safeWriteAuditLog,
    getLatestAuditMap,
    getAuditHistory,
    toTraceMeta,
};