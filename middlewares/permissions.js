const prisma = require('../lib/prisma');
const { setFlash } = require('../utils/flash');

const GLOBAL_ADMIN_ROLES = ['SUPER_ADMIN'];
const LOCAL_ADMIN_ROLES = ['ADMIN_CAMPUS'];

function isGlobalAdmin(admin) {
    return Boolean(admin && GLOBAL_ADMIN_ROLES.includes(admin.role));
}

function isCampusAdmin(admin) {
    return Boolean(admin && LOCAL_ADMIN_ROLES.includes(admin.role));
}

async function resolveCurrentAdmin(req) {
    if (req.currentAdmin) {
        return req.currentAdmin;
    }

    if (!req.session || !req.session.adminId) {
        return null;
    }

    const admin = await prisma.adminUser.findUnique({
        where: { id: req.session.adminId },
        select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            role: true,
            isActive: true,
            campusId: true,
            departmentId: true,
        },
    });

    req.currentAdmin = admin || null;
    return req.currentAdmin;
}

async function attachCurrentAdmin(req, res, next) {
    try {
        if (req.session && req.session.adminId) {
            await resolveCurrentAdmin(req);
        }
        return next();
    } catch (error) {
        return next(error);
    }
}

function ensureAdminRole(...allowedRoles) {
    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.adminId) {
                setFlash(req, 'error', 'Veuillez vous connecter en tant qu’administrateur.');
                return res.redirect('/admin/login');
            }

            const admin = await resolveCurrentAdmin(req);

            if (!admin || !admin.isActive) {
                delete req.session.adminId;
                delete req.session.adminRole;
                delete req.session.adminName;
                delete req.session.adminCampusId;
                delete req.session.adminDepartmentId;
                setFlash(req, 'error', 'Compte administrateur introuvable ou désactivé.');
                return res.redirect('/admin/login');
            }

            if (isGlobalAdmin(admin)) {
                return next();
            }

            if (allowedRoles.length > 0 && !allowedRoles.includes(admin.role)) {
                setFlash(req, 'error', 'Vous n’avez pas les autorisations nécessaires.');
                return res.redirect('/admin/dashboard');
            }

            if (isCampusAdmin(admin) && !admin.campusId) {
                setFlash(
                    req,
                    'error',
                    'Compte ADMIN_CAMPUS invalide : aucun campus n’est rattaché à ce compte.'
                );
                return res.redirect('/admin/login');
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

function canAccessScope(admin, { campusId = null } = {}) {
    if (!admin) return false;

    if (isGlobalAdmin(admin)) {
        return true;
    }

    if (!isCampusAdmin(admin)) {
        return false;
    }

    if (!admin.campusId) {
        return false;
    }

    if (campusId && admin.campusId !== campusId) {
        return false;
    }

    return true;
}

function ensureAdminScope(options = {}) {
    const {
        campusField = 'campusId',
        source = 'body',
        allowSuperAdmin = true,
    } = options;

    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.adminId) {
                setFlash(req, 'error', 'Veuillez vous connecter en tant qu’administrateur.');
                return res.redirect('/admin/login');
            }

            const admin = await resolveCurrentAdmin(req);

            if (!admin || !admin.isActive) {
                delete req.session.adminId;
                delete req.session.adminRole;
                delete req.session.adminName;
                delete req.session.adminCampusId;
                delete req.session.adminDepartmentId;
                setFlash(req, 'error', 'Compte administrateur introuvable ou désactivé.');
                return res.redirect('/admin/login');
            }

            if (allowSuperAdmin && isGlobalAdmin(admin)) {
                return next();
            }

            if (!admin.campusId) {
                setFlash(
                    req,
                    'error',
                    'Compte ADMIN_CAMPUS invalide : aucun campus n’est rattaché à ce compte.'
                );
                return res.redirect('/admin/dashboard');
            }

            const sourceObject =
                source === 'params'
                    ? req.params
                    : source === 'query'
                        ? req.query
                        : req.body;

            const campusId = sourceObject ? sourceObject[campusField] : null;

            if (!campusId) {
                return next();
            }

            if (!canAccessScope(admin, { campusId })) {
                setFlash(req, 'error', 'Accès refusé : campus non autorisé.');
                return res.redirect('/admin/dashboard');
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

function buildAdminScopedWhere(
    admin,
    { baseWhere = {}, campusField = 'campusId' } = {}
) {
    const where = { ...baseWhere };

    if (!admin || isGlobalAdmin(admin)) {
        return where;
    }

    if (isCampusAdmin(admin) && admin.campusId && campusField) {
        where[campusField] = admin.campusId;
    }

    return where;
}

module.exports = {
    GLOBAL_ADMIN_ROLES,
    LOCAL_ADMIN_ROLES,
    attachCurrentAdmin,
    ensureAdminRole,
    ensureAdminScope,
    buildAdminScopedWhere,
    isGlobalAdmin,
    isCampusAdmin,
    canAccessScope,
    resolveCurrentAdmin,
};