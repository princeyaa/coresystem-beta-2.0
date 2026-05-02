// src/services/activeSessionService.js
const prisma = require('../lib/prisma');
const { sessionMaxAgeMs } = require('../middlewares/sessionConfig');

const ACTIVE_SESSION_REASONS = Object.freeze({
    NEW_LOGIN: 'NEW_LOGIN',
    LOGOUT: 'LOGOUT',
    EXPIRED: 'EXPIRED',
    ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
    INVALID: 'INVALID',
});

function getRequestIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];

    if (forwardedFor && typeof forwardedFor === 'string') {
        return forwardedFor.split(',')[0].trim().slice(0, 80);
    }

    if (req.socket && req.socket.remoteAddress) {
        return req.socket.remoteAddress.slice(0, 80);
    }

    return null;
}

function getUserAgent(req) {
    const userAgent = req.headers['user-agent'];

    return typeof userAgent === 'string'
        ? userAgent.slice(0, 500)
        : null;
}

function buildExpiresAt() {
    return new Date(Date.now() + sessionMaxAgeMs);
}

function getSessionId(req) {
    return req.sessionID || null;
}

/**
 * Révoque uniquement les anciennes sessions du même compte.
 *
 * Important :
 * On ne supprime PAS la ligne technique dans CoreSystemSessions ici.
 * CoreSystemSessions est stockée dans une base technique séparée.
 *
 * La règle professionnelle :
 * - ActiveSession dit si la session est valide ou révoquée.
 * - CoreSystemSessions stocke techniquement la session Express.
 * - Au prochain refresh, le middleware voit que l’ActiveSession est révoquée,
 *   affiche un message propre, puis détruit la session.
 */
async function revokePreviousSessions({ actorType, actorId, keepSessionId = null }) {
    const where = {
        actorType,
        actorId,
        revokedAt: null,
    };

    if (keepSessionId) {
        where.sessionId = {
            not: keepSessionId,
        };
    }

    await prisma.activeSession.updateMany({
        where,
        data: {
            revokedAt: new Date(),
            revokedReason: ACTIVE_SESSION_REASONS.NEW_LOGIN,
        },
    });
}

async function createActiveSession({ req, actorType, actorId, portal }) {
    const sessionId = getSessionId(req);

    if (!sessionId) {
        throw new Error('Impossible de créer ActiveSession : sessionID introuvable.');
    }

    await revokePreviousSessions({
        actorType,
        actorId,
        keepSessionId: sessionId,
    });

    return prisma.activeSession.create({
        data: {
            actorType,
            actorId,
            portal,
            sessionId,
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
            lastSeenAt: new Date(),
            expiresAt: buildExpiresAt(),
        },
    });
}

async function validateActiveSession({ req, actorType, actorId }) {
    const activeSessionId = req.session ? req.session.activeSessionId : null;
    const sessionId = getSessionId(req);

    if (!activeSessionId || !sessionId) {
        return {
            ok: false,
            reason: ACTIVE_SESSION_REASONS.INVALID,
            message: 'Session invalide. Veuillez vous reconnecter.',
        };
    }

    const activeSession = await prisma.activeSession.findFirst({
        where: {
            id: activeSessionId,
            actorType,
            actorId,
            sessionId,
        },
    });

    if (!activeSession) {
        return {
            ok: false,
            reason: ACTIVE_SESSION_REASONS.INVALID,
            message: 'Session invalide. Veuillez vous reconnecter.',
        };
    }

    if (activeSession.revokedAt) {
        const message =
            activeSession.revokedReason === ACTIVE_SESSION_REASONS.NEW_LOGIN
                ? 'Votre session a été fermée car votre compte a été connecté sur un autre appareil.'
                : 'Votre session a été fermée. Veuillez vous reconnecter.';

        return {
            ok: false,
            reason: activeSession.revokedReason || ACTIVE_SESSION_REASONS.INVALID,
            message,
        };
    }

    if (activeSession.expiresAt && activeSession.expiresAt.getTime() < Date.now()) {
        await prisma.activeSession.update({
            where: {
                id: activeSession.id,
            },
            data: {
                revokedAt: new Date(),
                revokedReason: ACTIVE_SESSION_REASONS.EXPIRED,
            },
        });

        return {
            ok: false,
            reason: ACTIVE_SESSION_REASONS.EXPIRED,
            message: 'Session expirée après 1h d’inactivité. Veuillez vous reconnecter.',
        };
    }

    const updatedSession = await prisma.activeSession.update({
        where: {
            id: activeSession.id,
        },
        data: {
            lastSeenAt: new Date(),
            expiresAt: buildExpiresAt(),
        },
    });

    return {
        ok: true,
        activeSession: updatedSession,
    };
}

async function revokeCurrentActiveSession(req, reason = ACTIVE_SESSION_REASONS.LOGOUT) {
    const activeSessionId = req.session ? req.session.activeSessionId : null;

    if (!activeSessionId) {
        return;
    }

    try {
        await prisma.activeSession.updateMany({
            where: {
                id: activeSessionId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
                revokedReason: reason,
            },
        });
    } catch (error) {
        console.error('Erreur révocation ActiveSession :', error);
    }
}

module.exports = {
    ACTIVE_SESSION_REASONS,
    createActiveSession,
    validateActiveSession,
    revokeCurrentActiveSession,
    revokePreviousSessions,
};