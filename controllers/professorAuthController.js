// src/controllers/professorAuthController.js
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

function renderLogin(res, status, error) {
    return res.status(status).render('professor/login', {
        pageTitle: 'Connexion professeur',
        error,
    });
}

exports.getLogin = (req, res) => {
    return res.render('professor/login', {
        pageTitle: 'Connexion professeur',
        error: null,
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
                'Veuillez renseigner votre email et votre mot de passe.'
            );
        }

        const professor = await prisma.professor.findUnique({
            where: { email },
        });

        if (!professor || !professor.isActive) {
            return renderLogin(
                res,
                401,
                'Email ou mot de passe incorrect.'
            );
        }

        const passwordMatch = await bcrypt.compare(password, professor.password);

        if (!passwordMatch) {
            return renderLogin(
                res,
                401,
                'Email ou mot de passe incorrect.'
            );
        }

        await regenerateSession(req);

        clearOtherRoleSessions(req, 'professor');

        req.session.professorId = professor.id;
        req.session.role = 'professor';
        req.session.professorName = `${professor.prenom} ${professor.nom}`;
        req.session.professorCampusId = professor.campusId || null;
        req.session.professorDepartmentId = professor.departmentId || null;
        req.session.portal = 'PROFESSOR';

        const activeSession = await createActiveSession({
            req,
            actorType: 'PROFESSOR',
            actorId: professor.id,
            portal: 'PROFESSOR',
        });

        req.session.activeSessionId = activeSession.id;

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
            entityId: professor.id,
            action: AUDIT_ACTIONS.LOGIN,
            campusId: professor.campusId || null,
            summary: `Connexion professeur : ${professor.prenom} ${professor.nom}`,
            beforeData: null,
            afterData: {
                portal: 'PROFESSOR',
                professorId: professor.id,
                email: professor.email,
                campusId: professor.campusId || null,
                departmentId: professor.departmentId || null,
                activeSessionId: activeSession.id,
            },
        });

        await saveSession(req);

        return res.redirect('/professor/dashboard');
    } catch (error) {
        console.error('Erreur connexion professeur :', error);

        return renderLogin(
            res,
            500,
            'Erreur interne du serveur.'
        );
    }
};

exports.logout = async (req, res) => {
    try {
        if (req.session && req.session.professorId) {
            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
                entityId: req.session.professorId,
                action: AUDIT_ACTIONS.LOGOUT,
                campusId: req.session.professorCampusId || null,
                summary: `Déconnexion professeur : ${req.session.professorName || 'Professeur'}`,
                beforeData: {
                    portal: 'PROFESSOR',
                    professorId: req.session.professorId,
                    campusId: req.session.professorCampusId || null,
                    departmentId: req.session.professorDepartmentId || null,
                    activeSessionId: req.session.activeSessionId || null,
                },
                afterData: null,
            });

            await revokeCurrentActiveSession(req, ACTIVE_SESSION_REASONS.LOGOUT);
        }
    } catch (error) {
        console.error('Erreur logout professeur :', error);
    }

    await destroySession(req);

    return res.redirect('/professor/login');
};