// src/middlewares/auth.js
const prisma = require('../lib/prisma');
const { setFlash } = require('../utils/flash');
const {
    validateActiveSession,
    revokeCurrentActiveSession,
    ACTIVE_SESSION_REASONS,
} = require('../services/activeSessionService');

function getCurrentActorType(session) {
    if (!session) return null;
    if (session.adminId) return 'admin';
    if (session.professorId) return 'professor';
    if (session.userId) return 'student';
    return null;
}

/**
 * Gardée pour compatibilité.
 * Les sessions des portails sont séparées.
 * Cette fonction ne doit plus supprimer les autres acteurs.
 */
function clearOtherRoleSessions(req, keep) {
    return;
}

function destroyCurrentSession(req) {
    return new Promise((resolve) => {
        if (!req.session) {
            return resolve();
        }

        req.session.destroy(() => resolve());
    });
}

async function rejectSession(req, res, loginPath, message) {
    if (message) {
        setFlash(req, 'error', message);
    }

    await destroyCurrentSession(req);

    return res.redirect(loginPath);
}

async function validateBusinessSession(req, res, options) {
    const result = await validateActiveSession({
        req,
        actorType: options.actorType,
        actorId: options.actorId,
    });

    if (!result.ok) {
        return {
            ok: false,
            response: await rejectSession(
                req,
                res,
                options.loginPath,
                result.message
            ),
        };
    }

    return { ok: true };
}

// =======================================================
// MIDDLEWARES DE PROTECTION
// =======================================================

async function ensureAuthenticated(req, res, next) {
    try {
        if (!req.session || !req.session.userId) {
            setFlash(req, 'error', 'Veuillez vous connecter pour accéder à cette page.');
            return res.redirect('/login');
        }

        const student = await prisma.student.findUnique({
            where: { id: req.session.userId },
            select: {
                id: true,
                nom: true,
                prenom: true,
                matricule: true,
            },
        });

        if (!student) {
            return rejectSession(
                req,
                res,
                '/login',
                'Compte étudiant introuvable. Veuillez vous reconnecter.'
            );
        }

        const sessionCheck = await validateBusinessSession(req, res, {
            actorType: 'STUDENT',
            actorId: student.id,
            loginPath: '/login',
        });

        if (!sessionCheck.ok) {
            return sessionCheck.response;
        }

        req.currentStudent = student;
        return next();
    } catch (error) {
        console.error('Erreur vérification session étudiant :', error);
        return rejectSession(
            req,
            res,
            '/login',
            'Erreur de session. Veuillez vous reconnecter.'
        );
    }
}

function ensureStudent(req, res, next) {
    return ensureAuthenticated(req, res, next);
}

async function ensureAdmin(req, res, next) {
    try {
        if (!req.session || !req.session.adminId) {
            setFlash(req, 'error', 'Veuillez vous connecter en tant qu’administrateur.');
            return res.redirect('/admin/login');
        }

        const admin = await prisma.adminUser.findUnique({
            where: { id: req.session.adminId },
            include: {
                campus: true,
                department: true,
            },
        });

        if (!admin) {
            return rejectSession(
                req,
                res,
                '/admin/login',
                'Compte administrateur introuvable. Veuillez vous reconnecter.'
            );
        }

        if (!admin.isActive) {
            await revokeCurrentActiveSession(
                req,
                ACTIVE_SESSION_REASONS.ACCOUNT_DISABLED
            );

            return rejectSession(
                req,
                res,
                '/admin/login',
                'Votre compte administrateur est désactivé.'
            );
        }

        const sessionCheck = await validateBusinessSession(req, res, {
            actorType: 'ADMIN',
            actorId: admin.id,
            loginPath: '/admin/login',
        });

        if (!sessionCheck.ok) {
            return sessionCheck.response;
        }

        req.currentAdmin = admin;

        req.session.adminRole = admin.role;
        req.session.adminName = `${admin.prenom} ${admin.nom}`;
        req.session.adminCampusId = admin.campusId || null;
        req.session.adminDepartmentId = admin.departmentId || null;

        return next();
    } catch (error) {
        console.error('Erreur vérification session admin :', error);
        return rejectSession(
            req,
            res,
            '/admin/login',
            'Erreur de session. Veuillez vous reconnecter.'
        );
    }
}

async function ensureProfessor(req, res, next) {
    try {
        if (!req.session || !req.session.professorId) {
            setFlash(req, 'error', 'Veuillez vous connecter en tant que professeur.');
            return res.redirect('/professor/login');
        }

        const professor = await prisma.professor.findUnique({
            where: { id: req.session.professorId },
            include: {
                campus: true,
                department: true,
            },
        });

        if (!professor) {
            return rejectSession(
                req,
                res,
                '/professor/login',
                'Compte professeur introuvable. Veuillez vous reconnecter.'
            );
        }

        if (!professor.isActive) {
            await revokeCurrentActiveSession(
                req,
                ACTIVE_SESSION_REASONS.ACCOUNT_DISABLED
            );

            return rejectSession(
                req,
                res,
                '/professor/login',
                'Votre compte professeur est désactivé.'
            );
        }

        const sessionCheck = await validateBusinessSession(req, res, {
            actorType: 'PROFESSOR',
            actorId: professor.id,
            loginPath: '/professor/login',
        });

        if (!sessionCheck.ok) {
            return sessionCheck.response;
        }

        req.currentProfessor = professor;

        req.session.professorName = `${professor.prenom} ${professor.nom}`;
        req.session.professorCampusId = professor.campusId || null;
        req.session.professorDepartmentId = professor.departmentId || null;

        return next();
    } catch (error) {
        console.error('Erreur vérification session professeur :', error);
        return rejectSession(
            req,
            res,
            '/professor/login',
            'Erreur de session. Veuillez vous reconnecter.'
        );
    }
}

// =======================================================
// REDIRECTIONS SI DÉJÀ CONNECTÉ
// =======================================================

function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return res.redirect('/dashboard');
    }

    return next();
}

function redirectIfStudentAuthenticated(req, res, next) {
    return redirectIfAuthenticated(req, res, next);
}

function redirectIfAdminAuthenticated(req, res, next) {
    if (req.session && req.session.adminId) {
        return res.redirect('/admin/dashboard');
    }

    return next();
}

function redirectIfProfessorAuthenticated(req, res, next) {
    if (req.session && req.session.professorId) {
        return res.redirect('/professor/dashboard');
    }

    return next();
}

function ensureGuest(req, res, next) {
    const actorType = getCurrentActorType(req.session);

    if (actorType === 'admin') {
        return res.redirect('/admin/dashboard');
    }

    if (actorType === 'professor') {
        return res.redirect('/professor/dashboard');
    }

    if (actorType === 'student') {
        return res.redirect('/dashboard');
    }

    return next();
}

function ensureNotAuthenticated(req, res, next) {
    return ensureGuest(req, res, next);
}

function ensureGuestStudent(req, res, next) {
    if (req.session && req.session.userId) {
        return res.redirect('/dashboard');
    }

    return next();
}

function ensureGuestAdmin(req, res, next) {
    if (req.session && req.session.adminId) {
        return res.redirect('/admin/dashboard');
    }

    return next();
}

function ensureGuestProfessor(req, res, next) {
    if (req.session && req.session.professorId) {
        return res.redirect('/professor/dashboard');
    }

    return next();
}

module.exports = {
    ensureAuthenticated,
    ensureStudent,
    ensureAdmin,
    ensureProfessor,
    redirectIfAuthenticated,
    redirectIfStudentAuthenticated,
    redirectIfAdminAuthenticated,
    redirectIfProfessorAuthenticated,
    ensureGuest,
    ensureNotAuthenticated,
    ensureGuestStudent,
    ensureGuestAdmin,
    ensureGuestProfessor,
    clearOtherRoleSessions,
    getCurrentActorType,
};