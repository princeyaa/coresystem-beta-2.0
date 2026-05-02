// src/controllers/authController.js
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
    return res.status(status).render('auth/login', {
        pageTitle: 'Connexion étudiant',
        error,
    });
}

exports.getLogin = (req, res) => {
    return res.render('auth/login', {
        pageTitle: 'Connexion étudiant',
        error: null,
    });
};

exports.postLogin = async (req, res) => {
    const matricule =
        typeof req.body.matricule === 'string'
            ? req.body.matricule.trim()
            : '';

    const password = req.body.password;

    try {
        if (!matricule || !password) {
            return renderLogin(
                res,
                400,
                'Veuillez renseigner votre matricule et votre mot de passe.'
            );
        }

        const student = await prisma.student.findUnique({
            where: { matricule },
        });

        if (!student) {
            return renderLogin(
                res,
                401,
                'Matricule ou mot de passe incorrect.'
            );
        }

        const passwordMatch = await bcrypt.compare(password, student.password);

        if (!passwordMatch) {
            return renderLogin(
                res,
                401,
                'Matricule ou mot de passe incorrect.'
            );
        }

        await regenerateSession(req);

        clearOtherRoleSessions(req, 'student');

        req.session.userId = student.id;
        req.session.studentName = `${student.prenom} ${student.nom}`;
        req.session.studentMatricule = student.matricule;
        req.session.portal = 'STUDENT';

        const activeSession = await createActiveSession({
            req,
            actorType: 'STUDENT',
            actorId: student.id,
            portal: 'STUDENT',
        });

        req.session.activeSessionId = activeSession.id;

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
            entityId: student.id,
            action: AUDIT_ACTIONS.LOGIN,
            campusId: null,
            summary: `Connexion étudiant : ${student.prenom} ${student.nom}`,
            beforeData: null,
            afterData: {
                portal: 'STUDENT',
                studentId: student.id,
                matricule: student.matricule,
                email: student.email || null,
                activeSessionId: activeSession.id,
            },
        });

        await saveSession(req);

        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Erreur lors de la connexion étudiant :', error);

        return renderLogin(
            res,
            500,
            'Erreur interne du serveur.'
        );
    }
};

exports.logout = async (req, res) => {
    try {
        if (req.session && req.session.userId) {
            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
                entityId: req.session.userId,
                action: AUDIT_ACTIONS.LOGOUT,
                campusId: null,
                summary: `Déconnexion étudiant : ${req.session.studentName || 'Étudiant'}`,
                beforeData: {
                    portal: 'STUDENT',
                    studentId: req.session.userId,
                    matricule: req.session.studentMatricule || null,
                    activeSessionId: req.session.activeSessionId || null,
                },
                afterData: null,
            });

            await revokeCurrentActiveSession(req, ACTIVE_SESSION_REASONS.LOGOUT);
        }
    } catch (error) {
        console.error('Erreur logout étudiant :', error);
    }

    await destroySession(req);

    return res.redirect('/login');
};