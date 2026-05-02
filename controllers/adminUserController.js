const bcrypt = require('bcrypt');

const { setFlash } = require('../utils/flash');
const adminUserService = require('../services/adminUserService');
const campusService = require('../services/campusService');
const { resolveCurrentAdmin } = require('../middlewares/permissions');
const {
    safeWriteAuditLog,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN_CAMPUS'];

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function generateTemporaryPassword() {
    const partA = Math.random().toString(36).slice(2, 6);
    const partB = Date.now().toString(36).slice(-4);
    return `CS-${partA}${partB}`;
}

function buildAdminForm(data = {}) {
    return {
        id: data.id || '',
        nom: data.nom || '',
        prenom: data.prenom || '',
        email: data.email || '',
        role: data.role || 'ADMIN_CAMPUS',
        campusId: data.campusId || '',
        isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
    };
}

function sanitizeAdminUserInput(body = {}) {
    const role = ADMIN_ROLES.includes(body.role) ? body.role : 'ADMIN_CAMPUS';

    return {
        nom: normalizeText(body.nom),
        prenom: normalizeText(body.prenom),
        email: normalizeEmail(body.email),
        role,
        campusId: normalizeText(body.campusId) || null,
    };
}

function buildAdminAuditSnapshot(adminUser) {
    if (!adminUser) return null;

    return {
        id: adminUser.id,
        nom: adminUser.nom,
        prenom: adminUser.prenom,
        email: adminUser.email,
        role: adminUser.role,
        isActive: adminUser.isActive,
        campusId: adminUser.campusId || null,
    };
}

async function validateAdminUserData(data, currentId = null) {
    if (!data.nom || !data.prenom || !data.email || !data.role) {
        return 'Le nom, le prénom, l’email et le rôle sont obligatoires.';
    }

    if (!ADMIN_ROLES.includes(data.role)) {
        return 'Le rôle sélectionné est invalide.';
    }

    if (!data.email.includes('@')) {
        return 'L’email est invalide.';
    }

    if (data.role === 'ADMIN_CAMPUS' && !data.campusId) {
        return 'Un ADMIN_CAMPUS doit obligatoirement être rattaché à un campus.';
    }

    if (data.role === 'SUPER_ADMIN') {
        data.campusId = null;
    }

    const existingByEmail = await adminUserService.getAdminUserByEmail(data.email);

    if (existingByEmail && existingByEmail.id !== currentId) {
        return 'Cet email est déjà utilisé par un autre compte administratif.';
    }

    return null;
}

async function renderForm(req, res, options) {
    const campuses = await campusService.getCampuses();

    return res.render('admin/users/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        adminUser: options.adminUser,
        roles: ADMIN_ROLES,
        campuses,
        error: options.error || null,
        session: req.session,
    });
}

exports.index = async (req, res) => {
    try {
        const adminUsers = await adminUserService.getAdminUsers();

        return res.render('admin/users/index', {
            pageTitle: 'Utilisateurs administratifs',
            adminUsers,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement utilisateurs administratifs :', error);
        setFlash(req, 'error', 'Impossible de charger les utilisateurs administratifs.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = async (req, res) => {
    return renderForm(req, res, {
        pageTitle: 'Nouvel utilisateur administratif',
        formAction: '/admin/users',
        submitLabel: 'Créer le compte',
        adminUser: buildAdminForm(),
    });
};

exports.store = async (req, res) => {
    const data = sanitizeAdminUserInput(req.body);
    const validationError = await validateAdminUserData(data);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Nouvel utilisateur administratif',
            formAction: '/admin/users',
            submitLabel: 'Créer le compte',
            adminUser: buildAdminForm(data),
            error: validationError,
        });
    }

    try {
        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        const createdAdmin = await adminUserService.createAdminUser({
            nom: data.nom,
            prenom: data.prenom,
            email: data.email,
            role: data.role,
            campusId: data.role === 'SUPER_ADMIN' ? null : data.campusId,
            departmentId: null,
            password: passwordHash,
            isActive: true,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ADMIN_USER,
            entityId: createdAdmin.id,
            action: AUDIT_ACTIONS.CREATE,
            campusId: createdAdmin.campusId || null,
            summary: `Création du compte admin ${createdAdmin.prenom} ${createdAdmin.nom}`,
            beforeData: null,
            afterData: buildAdminAuditSnapshot(createdAdmin),
        });

        setFlash(
            req,
            'success',
            `Compte administratif créé. Mot de passe temporaire : ${temporaryPassword}`
        );

        return res.redirect('/admin/users');
    } catch (error) {
        console.error('Erreur création utilisateur administratif :', error);

        return renderForm(req, res, {
            pageTitle: 'Nouvel utilisateur administratif',
            formAction: '/admin/users',
            submitLabel: 'Créer le compte',
            adminUser: buildAdminForm(data),
            error: 'Une erreur est survenue lors de la création du compte.',
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const adminUser = await adminUserService.getAdminUserById(req.params.id);

        if (!adminUser) {
            setFlash(req, 'error', 'Utilisateur administratif introuvable.');
            return res.redirect('/admin/users');
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier un utilisateur administratif',
            formAction: `/admin/users/${adminUser.id}`,
            submitLabel: 'Enregistrer les modifications',
            adminUser: buildAdminForm(adminUser),
        });
    } catch (error) {
        console.error('Erreur formulaire édition admin user :', error);
        setFlash(req, 'error', 'Impossible de charger ce compte.');
        return res.redirect('/admin/users');
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const currentAdmin = await resolveCurrentAdmin(req);
    const existingAdmin = await adminUserService.getAdminUserById(id);

    if (!existingAdmin) {
        setFlash(req, 'error', 'Utilisateur administratif introuvable.');
        return res.redirect('/admin/users');
    }

    const data = sanitizeAdminUserInput(req.body);
    const validationError = await validateAdminUserData(data, id);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Modifier un utilisateur administratif',
            formAction: `/admin/users/${id}`,
            submitLabel: 'Enregistrer les modifications',
            adminUser: buildAdminForm({ id, ...data }),
            error: validationError,
        });
    }

    if (existingAdmin.role === 'SUPER_ADMIN' && data.role !== 'SUPER_ADMIN') {
        const activeSuperAdmins = await adminUserService.countActiveSuperAdmins();

        if (activeSuperAdmins <= 1 && existingAdmin.isActive) {
            return renderForm(req, res, {
                pageTitle: 'Modifier un utilisateur administratif',
                formAction: `/admin/users/${id}`,
                submitLabel: 'Enregistrer les modifications',
                adminUser: buildAdminForm({ id, ...data }),
                error: 'Impossible de retirer le rôle du dernier super administrateur actif.',
            });
        }
    }

    try {
        const beforeSnapshot = buildAdminAuditSnapshot(existingAdmin);

        const updatedAdmin = await adminUserService.updateAdminUser(id, {
            nom: data.nom,
            prenom: data.prenom,
            email: data.email,
            role: data.role,
            campusId: data.role === 'SUPER_ADMIN' ? null : data.campusId,
            departmentId: null,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ADMIN_USER,
            entityId: updatedAdmin.id,
            action: AUDIT_ACTIONS.UPDATE,
            campusId: updatedAdmin.campusId || null,
            summary: `Modification du compte admin ${updatedAdmin.prenom} ${updatedAdmin.nom}`,
            beforeData: beforeSnapshot,
            afterData: buildAdminAuditSnapshot(updatedAdmin),
        });

        if (currentAdmin && currentAdmin.id === id) {
            req.session.adminRole = data.role;
            req.session.adminName = `${data.prenom} ${data.nom}`;
            req.session.adminCampusId = data.role === 'SUPER_ADMIN' ? null : data.campusId || null;
            req.session.adminDepartmentId = null;
        }

        setFlash(req, 'success', 'Compte administratif mis à jour avec succès.');
        return res.redirect('/admin/users');
    } catch (error) {
        console.error('Erreur mise à jour admin user :', error);

        return renderForm(req, res, {
            pageTitle: 'Modifier un utilisateur administratif',
            formAction: `/admin/users/${id}`,
            submitLabel: 'Enregistrer les modifications',
            adminUser: buildAdminForm({ id, ...data }),
            error: 'Une erreur est survenue lors de la mise à jour.',
        });
    }
};

exports.toggleActive = async (req, res) => {
    const { id } = req.params;

    try {
        const currentAdmin = await resolveCurrentAdmin(req);
        const targetAdmin = await adminUserService.getAdminUserById(id);

        if (!targetAdmin) {
            setFlash(req, 'error', 'Utilisateur administratif introuvable.');
            return res.redirect('/admin/users');
        }

        if (currentAdmin && currentAdmin.id === id) {
            setFlash(req, 'error', 'Vous ne pouvez pas désactiver votre propre compte.');
            return res.redirect('/admin/users');
        }

        if (targetAdmin.role === 'SUPER_ADMIN' && targetAdmin.isActive) {
            const activeSuperAdmins = await adminUserService.countActiveSuperAdmins();

            if (activeSuperAdmins <= 1) {
                setFlash(req, 'error', 'Impossible de désactiver le dernier super administrateur actif.');
                return res.redirect('/admin/users');
            }
        }

        const updatedAdmin = await adminUserService.toggleAdminActiveState(id, !targetAdmin.isActive);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ADMIN_USER,
            entityId: updatedAdmin.id,
            action: updatedAdmin.isActive ? AUDIT_ACTIONS.ACTIVATE : AUDIT_ACTIONS.DEACTIVATE,
            campusId: updatedAdmin.campusId || null,
            summary: `${updatedAdmin.isActive ? 'Réactivation' : 'Désactivation'} du compte admin ${updatedAdmin.prenom} ${updatedAdmin.nom}`,
            beforeData: buildAdminAuditSnapshot(targetAdmin),
            afterData: buildAdminAuditSnapshot(updatedAdmin),
        });

        setFlash(
            req,
            'success',
            updatedAdmin.isActive
                ? 'Compte administratif réactivé avec succès.'
                : 'Compte administratif désactivé avec succès.'
        );

        return res.redirect('/admin/users');
    } catch (error) {
        console.error('Erreur activation/désactivation admin :', error);
        setFlash(req, 'error', 'Impossible de modifier l’état du compte.');
        return res.redirect('/admin/users');
    }
};

exports.resetPassword = async (req, res) => {
    const { id } = req.params;

    try {
        const targetAdmin = await adminUserService.getAdminUserById(id);

        if (!targetAdmin) {
            setFlash(req, 'error', 'Utilisateur administratif introuvable.');
            return res.redirect('/admin/users');
        }

        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        await adminUserService.updateAdminPassword(id, passwordHash);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ADMIN_USER,
            entityId: targetAdmin.id,
            action: AUDIT_ACTIONS.RESET_PASSWORD,
            campusId: targetAdmin.campusId || null,
            summary: `Réinitialisation du mot de passe admin ${targetAdmin.prenom} ${targetAdmin.nom}`,
            beforeData: buildAdminAuditSnapshot(targetAdmin),
            afterData: {
                ...buildAdminAuditSnapshot(targetAdmin),
                password: '[REDACTED]',
            },
        });

        setFlash(
            req,
            'success',
            `Mot de passe réinitialisé pour ${targetAdmin.prenom} ${targetAdmin.nom}. Nouveau mot de passe : ${temporaryPassword}`
        );

        return res.redirect('/admin/users');
    } catch (error) {
        console.error('Erreur reset password admin :', error);
        setFlash(req, 'error', 'Impossible de réinitialiser le mot de passe.');
        return res.redirect('/admin/users');
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;

    try {
        const currentAdmin = await resolveCurrentAdmin(req);
        const targetAdmin = await adminUserService.getAdminUserById(id);

        if (!targetAdmin) {
            setFlash(req, 'error', 'Utilisateur administratif introuvable.');
            return res.redirect('/admin/users');
        }

        if (currentAdmin && currentAdmin.id === id) {
            setFlash(req, 'error', 'Vous ne pouvez pas supprimer votre propre compte.');
            return res.redirect('/admin/users');
        }

        if (targetAdmin.role === 'SUPER_ADMIN') {
            const activeSuperAdmins = await adminUserService.countActiveSuperAdmins();

            if (activeSuperAdmins <= 1 && targetAdmin.isActive) {
                setFlash(req, 'error', 'Impossible de supprimer le dernier super administrateur actif.');
                return res.redirect('/admin/users');
            }
        }

        const hasDependencies =
            targetAdmin._count.announcements > 0 ||
            targetAdmin._count.treatedRequests > 0;

        if (hasDependencies) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : ce compte possède un historique. Désactivez-le plutôt.'
            );
            return res.redirect('/admin/users');
        }

        const beforeSnapshot = buildAdminAuditSnapshot(targetAdmin);

        await adminUserService.deleteAdminUser(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ADMIN_USER,
            entityId: targetAdmin.id,
            action: AUDIT_ACTIONS.DELETE,
            campusId: targetAdmin.campusId || null,
            summary: `Suppression du compte admin ${targetAdmin.prenom} ${targetAdmin.nom}`,
            beforeData: beforeSnapshot,
            afterData: null,
        });

        setFlash(req, 'success', 'Compte administratif supprimé avec succès.');
        return res.redirect('/admin/users');
    } catch (error) {
        console.error('Erreur suppression admin user :', error);
        setFlash(req, 'error', 'Impossible de supprimer ce compte.');
        return res.redirect('/admin/users');
    }
};