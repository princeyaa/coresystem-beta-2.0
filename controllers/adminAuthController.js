// src/controllers/adminAuthController.js
const prisma = require('../lib/prisma');
const bcrypt = require('bcrypt');
const { clearOtherRoleSessions } = require('../middlewares/auth');
const {
    createActiveSession,
    revokeCurrentActiveSession,
    ACTIVE_SESSION_REASONS,
} = require('../services/activeSessionService');
const {
    safeWriteAuditLog,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) return reject(error);
            return resolve();
        });
    });
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((error) => {
            if (error) return reject(error);
            return resolve();
        });
    });
}

function destroySession(req) {
    return new Promise((resolve) => {
        if (!req.session) return resolve();
        req.session.destroy(() => resolve());
    });
}

function renderLogin(res, status, error, session = null) {
    return res.status(status).render('admin/login', {
        error,
        session,
    });
}

exports.getLogin = (req, res) => {
    return res.render('admin/login', {
        error: null,
        session: req.session,
    });
};

exports.postLogin = async (req, res) => {
    const email =
        typeof req.body.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : '';

    const password = req.body.password;

    try {
        if (!email || !password) {
            return renderLogin(
                res,
                400,
                'Veuillez renseigner votre email et votre mot de passe.',
                req.session
            );
        }

        const admin = await prisma.adminUser.findUnique({
            where: { email },
        });

        if (!admin) {
            return renderLogin(
                res,
                401,
                'Email ou mot de passe incorrect.',
                req.session
            );
        }

        if (!admin.isActive) {
            return renderLogin(
                res,
                403,
                'Ce compte administrateur est désactivé.',
                req.session
            );
        }

        const passwordMatch = await bcrypt.compare(password, admin.password);

        if (!passwordMatch) {
            return renderLogin(
                res,
                401,
                'Email ou mot de passe incorrect.',
                req.session
            );
        }

        await regenerateSession(req);

        clearOtherRoleSessions(req, 'admin');

        req.session.adminId = admin.id;
        req.session.adminRole = admin.role;
        req.session.adminName = `${admin.prenom} ${admin.nom}`;
        req.session.adminCampusId = admin.campusId || null;
        req.session.adminDepartmentId = admin.departmentId || null;
        req.session.portal = 'ADMIN';

        const activeSession = await createActiveSession({
            req,
            actorType: 'ADMIN',
            actorId: admin.id,
            portal: 'ADMIN',
        });

        req.session.activeSessionId = activeSession.id;

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
            entityId: admin.id,
            action: AUDIT_ACTIONS.LOGIN,
            campusId: admin.campusId || null,
            summary: `Connexion administrateur : ${admin.prenom} ${admin.nom}`,
            beforeData: null,
            afterData: {
                portal: 'ADMIN',
                adminId: admin.id,
                email: admin.email,
                role: admin.role,
                campusId: admin.campusId || null,
                activeSessionId: activeSession.id,
            },
        });

        await saveSession(req);

        return res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Erreur lors de la connexion admin :', error);

        return renderLogin(
            res,
            500,
            'Erreur interne du serveur.',
            req.session
        );
    }
};

exports.logout = async (req, res) => {
    try {
        if (req.session && req.session.adminId) {
            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
                entityId: req.session.adminId,
                action: AUDIT_ACTIONS.LOGOUT,
                campusId: req.session.adminCampusId || null,
                summary: `Déconnexion administrateur : ${req.session.adminName || 'Administrateur'}`,
                beforeData: {
                    portal: 'ADMIN',
                    adminId: req.session.adminId,
                    role: req.session.adminRole || null,
                    campusId: req.session.adminCampusId || null,
                    activeSessionId: req.session.activeSessionId || null,
                },
                afterData: null,
            });

            await revokeCurrentActiveSession(req, ACTIVE_SESSION_REASONS.LOGOUT);
        }
    } catch (error) {
        console.error('Erreur logout admin :', error);
    }

    await destroySession(req);

    return res.redirect('/admin/login');
};