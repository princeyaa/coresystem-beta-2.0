const bcrypt = require('bcrypt');

const { setFlash } = require('../utils/flash');
const professorService = require('../services/professorService');
const campusService = require('../services/campusService');
const departmentService = require('../services/departmentService');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
    canAccessScope,
} = require('../middlewares/permissions');
const {
    safeWriteAuditLog,
    getLatestAuditMap,
    getAuditHistory,
    toTraceMeta,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function generateTemporaryPassword() {
    const partA = Math.random().toString(36).slice(2, 6);
    const partB = Date.now().toString(36).slice(-4);
    return `PF-${partA}${partB}`;
}

function isLocalAdminMisconfigured(admin) {
    return admin && !isGlobalAdmin(admin) && !admin.campusId;
}

function buildProfessorScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        campusId: admin.campusId,
    };
}

function filterCampusesByAdmin(campuses, admin) {
    if (!admin || isGlobalAdmin(admin)) return campuses;
    return campuses.filter((campus) => campus.id === admin.campusId);
}

function filterDepartmentsByAdmin(departments, admin) {
    if (!admin || isGlobalAdmin(admin)) return departments;
    return departments.filter((department) => department.campusId === admin.campusId);
}

async function validateDepartmentBelongsToCampus(campusId, departmentId) {
    if (!departmentId) return true;
    if (!campusId) return false;

    const department = await departmentService.getDepartmentById(departmentId);

    if (!department) return false;

    return department.campusId === campusId;
}

function buildEffectiveScope(admin, submittedCampusId, submittedDepartmentId) {
    if (isGlobalAdmin(admin)) {
        return {
            campusId: submittedCampusId || null,
            departmentId: submittedDepartmentId || null,
        };
    }

    return {
        campusId: admin.campusId,
        departmentId: submittedDepartmentId || null,
    };
}

function sanitizeProfessorInput(body = {}) {
    return {
        nom: normalizeText(body.nom),
        prenom: normalizeText(body.prenom),
        email: normalizeEmail(body.email),
        telephone: normalizeText(body.telephone) || null,
        campusId: normalizeText(body.campusId) || null,
        departmentId: normalizeText(body.departmentId) || null,
    };
}
function sanitizeSearchQuery(value) {
    return normalizeText(value).slice(0, 100);
}

function mergeWhereClauses(...clauses) {
    const filtered = clauses.filter(
        (clause) => clause && Object.keys(clause).length > 0
    );

    if (filtered.length === 0) {
        return {};
    }

    if (filtered.length === 1) {
        return filtered[0];
    }

    return {
        AND: filtered,
    };
}

function buildProfessorSearchWhere(rawQuery) {
    const searchQuery = sanitizeSearchQuery(rawQuery);

    if (!searchQuery) {
        return {
            searchQuery: '',
            searchWhere: {},
        };
    }

    const terms = searchQuery
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 5);

    if (!terms.length) {
        return {
            searchQuery: '',
            searchWhere: {},
        };
    }

    return {
        searchQuery,
        searchWhere: {
            AND: terms.map((term) => ({
                OR: [
                    { nom: { contains: term } },
                    { prenom: { contains: term } },
                    { email: { contains: term } },
                    { telephone: { contains: term } },
                ],
            })),
        },
    };
}

function buildProfessorForm(data = {}) {
    return {
        id: data.id || '',
        nom: data.nom || '',
        prenom: data.prenom || '',
        email: data.email || '',
        telephone: data.telephone || '',
        campusId: data.campusId || '',
        departmentId: data.departmentId || '',
        isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
    };
}

function buildProfessorAuditSnapshot(professor) {
    if (!professor) return null;

    return {
        id: professor.id,
        nom: professor.nom,
        prenom: professor.prenom,
        email: professor.email,
        telephone: professor.telephone,
        campusId: professor.campusId || null,
        departmentId: professor.departmentId || null,
        isActive: professor.isActive,
    };
}

async function validateProfessorInput(data, admin, currentProfessorId = null) {
    if (!data.nom || !data.prenom || !data.email) {
        return 'Veuillez renseigner au minimum le nom, le prénom et l’email.';
    }

    if (!data.email.includes('@')) {
        return 'L’email est invalide.';
    }

    const effectiveScope = buildEffectiveScope(admin, data.campusId, data.departmentId);

    if (!isGlobalAdmin(admin) && !effectiveScope.campusId) {
        return 'Votre compte administrateur local doit être rattaché à un campus.';
    }

    if (!canAccessScope(admin, { campusId: effectiveScope.campusId })) {
        return 'Accès refusé : vous ne pouvez pas gérer un enseignant hors de votre campus.';
    }

    const departmentMatchesCampus = await validateDepartmentBelongsToCampus(
        effectiveScope.campusId,
        effectiveScope.departmentId
    );

    if (!departmentMatchesCampus) {
        return 'Le département sélectionné ne correspond pas au campus choisi.';
    }

    const existingByEmail = await professorService.getProfessorByEmail(data.email);

    if (existingByEmail && existingByEmail.id !== currentProfessorId) {
        return 'Cet email est déjà utilisé par un autre enseignant.';
    }

    return null;
}
function sanitizeFilterId(value) {
    const normalized = normalizeText(value);

    if (!normalized || normalized === 'all') {
        return '';
    }

    return normalized;
}

function sanitizeProfessorStatus(value) {
    const normalized = normalizeText(value);

    if (['all', 'active', 'inactive'].includes(normalized)) {
        return normalized;
    }

    return 'all';
}

function sanitizeAssignmentStatus(value) {
    const normalized = normalizeText(value);

    if (['all', 'withAssignments', 'withoutAssignments'].includes(normalized)) {
        return normalized;
    }

    return 'all';
}

function buildProfessorFilterState(query = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return {
        campusId: isSuperAdmin
            ? sanitizeFilterId(query.campusId)
            : (admin && admin.campusId ? admin.campusId : ''),
        departmentId: sanitizeFilterId(query.departmentId),
        status: sanitizeProfessorStatus(query.status),
        assignmentStatus: sanitizeAssignmentStatus(query.assignmentStatus),
    };
}

function buildProfessorFiltersWhere(filters = {}) {
    const where = {};

    if (filters.campusId) {
        where.campusId = filters.campusId;
    }

    if (filters.departmentId) {
        where.departmentId = filters.departmentId;
    }

    if (filters.status === 'active') {
        where.isActive = true;
    }

    if (filters.status === 'inactive') {
        where.isActive = false;
    }

    if (filters.assignmentStatus === 'withAssignments') {
        where.assignments = {
            some: {},
        };
    }

    if (filters.assignmentStatus === 'withoutAssignments') {
        where.assignments = {
            none: {},
        };
    }

    return where;
}

function hasActiveProfessorFilters(searchQuery = '', filters = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return Boolean(
        searchQuery ||
        filters.departmentId ||
        filters.status !== 'all' ||
        filters.assignmentStatus !== 'all' ||
        (isSuperAdmin && filters.campusId)
    );
}

function buildProfessorFilterOptions({
    campuses = [],
    departments = [],
    filters = {},
    admin = null,
}) {
    const scopedCampuses = filterCampusesByAdmin(campuses, admin);

    let scopedDepartments = filterDepartmentsByAdmin(departments, admin);

    if (filters.campusId) {
        scopedDepartments = scopedDepartments.filter(function (department) {
            return department.campusId === filters.campusId;
        });
    }

    return {
        campuses: scopedCampuses,
        departments: scopedDepartments,
    };
}

const renderForm = async (req, res, options) => {
    const admin = options.admin || (await resolveCurrentAdmin(req));

    const [allCampuses, allDepartments] = await Promise.all([
        campusService.getCampuses(),
        departmentService.getDepartments(),
    ]);

    const campuses = filterCampusesByAdmin(allCampuses, admin);
    const departments = filterDepartmentsByAdmin(allDepartments, admin);

    return res.render('admin/professors/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        professor: options.professor,
        campuses,
        departments,
        error: options.error || null,
        session: req.session,
    });
};

exports.index = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const { searchQuery, searchWhere } = buildProfessorSearchWhere(req.query.q);
        const filters = buildProfessorFilterState(req.query, admin);

        const [allCampuses, allDepartments, professors] = await Promise.all([
            campusService.getCampuses(),
            departmentService.getDepartments(),
            professorService.getProfessors(
                mergeWhereClauses(
                    buildProfessorScopeWhere(admin),
                    searchWhere,
                    buildProfessorFiltersWhere(filters)
                )
            ),
        ]);

        const filterOptions = buildProfessorFilterOptions({
            campuses: allCampuses,
            departments: allDepartments,
            filters,
            admin,
        });

        return res.render('admin/professors/index', {
            pageTitle: 'Professeurs',
            professors,
            searchQuery,
            filters,
            filterOptions,
            isSuperAdmin: isGlobalAdmin(admin),
            hasActiveFilters: hasActiveProfessorFilters(searchQuery, filters, admin),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement professeurs admin :', error);
        setFlash(req, 'error', 'Impossible de charger les professeurs.');
        return res.redirect('/admin/dashboard');
    }
};
exports.show = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const professor = await professorService.getProfessorDetails(
            req.params.id,
            buildProfessorScopeWhere(admin)
        );

        if (!professor) {
            setFlash(req, 'error', 'Professeur introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/professors');
        }

        const assignments = professor.assignments || [];
        const recentGrades = professor.recentGrades || [];

        const assignmentIds = assignments.map((assignment) => assignment.id);
        const gradeIds = recentGrades.map((grade) => grade.id);

        const [
            latestProfessorAuditMap,
            latestAssignmentAudits,
            latestGradeAudits,
            professorTraceHistory,
        ] = await Promise.all([
            getLatestAuditMap(AUDIT_ENTITY_TYPES.PROFESSOR, [professor.id]),
            getLatestAuditMap(AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT, assignmentIds),
            getLatestAuditMap(AUDIT_ENTITY_TYPES.GRADE, gradeIds),
            getAuditHistory(AUDIT_ENTITY_TYPES.PROFESSOR, professor.id, { limit: 5 }),
        ]);

        const professorTraceMeta = toTraceMeta(
            latestProfessorAuditMap[professor.id],
            {
                label: 'Créé le',
                summary: 'Compte professeur enregistré dans CoreSystem',
                actorName: 'Système',
                actorRole: 'SYSTEM',
                createdAt: professor.createdAt,
            }
        );

        const assignmentTraceMap = {};
        assignments.forEach((assignment) => {
            assignmentTraceMap[assignment.id] = toTraceMeta(
                latestAssignmentAudits[assignment.id],
                null
            );
        });

        const gradeTraceMap = {};
        recentGrades.forEach((grade) => {
            gradeTraceMap[grade.id] = toTraceMeta(
                latestGradeAudits[grade.id],
                null
            );
        });

        return res.render('admin/professors/show', {
            pageTitle: `Professeur - ${professor.prenom} ${professor.nom}`,
            professor,
            professorTraceMeta,
            professorTraceHistory,
            assignmentTraceMap,
            gradeTraceMap,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement détail professeur :', error);
        setFlash(req, 'error', 'Impossible de charger la fiche professeur.');
        return res.redirect('/admin/professors');
    }
};
exports.createForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    return renderForm(req, res, {
        pageTitle: 'Nouvel enseignant',
        formAction: '/admin/professors',
        submitLabel: 'Créer l’enseignant',
        professor: buildProfessorForm({
            campusId: isGlobalAdmin(admin) ? '' : admin.campusId || '',
            departmentId: '',
        }),
        admin,
    });
};

exports.store = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const rawData = sanitizeProfessorInput(req.body);
    const validationError = await validateProfessorInput(rawData, admin);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Nouvel enseignant',
            formAction: '/admin/professors',
            submitLabel: 'Créer l’enseignant',
            professor: buildProfessorForm(rawData),
            error: validationError,
            admin,
        });
    }

    try {
        const effectiveScope = buildEffectiveScope(admin, rawData.campusId, rawData.departmentId);
        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        const createdProfessor = await professorService.createProfessor({
            nom: rawData.nom,
            prenom: rawData.prenom,
            email: rawData.email,
            telephone: rawData.telephone,
            campusId: effectiveScope.campusId,
            departmentId: effectiveScope.departmentId,
            password: passwordHash,
            isActive: true,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.PROFESSOR,
            entityId: createdProfessor.id,
            action: AUDIT_ACTIONS.CREATE,
            campusId: createdProfessor.campusId || null,
            summary: `Création du compte professeur ${createdProfessor.prenom} ${createdProfessor.nom}`,
            beforeData: null,
            afterData: buildProfessorAuditSnapshot(createdProfessor),
        });

        setFlash(
            req,
            'success',
            `Enseignant créé avec succès. Mot de passe temporaire : ${temporaryPassword}`
        );

        return res.redirect('/admin/professors');
    } catch (error) {
        console.error('Erreur création enseignant :', error);

        let message = 'Une erreur est survenue lors de la création.';
        if (error.code === 'P2002') {
            message = 'Cet email existe déjà.';
        }

        return renderForm(req, res, {
            pageTitle: 'Nouvel enseignant',
            formAction: '/admin/professors',
            submitLabel: 'Créer l’enseignant',
            professor: buildProfessorForm(rawData),
            error: message,
            admin,
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const professor = await professorService.getProfessorById(
            req.params.id,
            buildProfessorScopeWhere(admin)
        );

        if (!professor) {
            setFlash(req, 'error', 'Enseignant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/professors');
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier l’enseignant',
            formAction: `/admin/professors/${professor.id}`,
            submitLabel: 'Enregistrer les modifications',
            professor: buildProfessorForm(professor),
            admin,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition enseignant :', error);
        setFlash(req, 'error', 'Impossible de charger cet enseignant.');
        return res.redirect('/admin/professors');
    }
};

exports.update = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const { id } = req.params;
    const existingProfessor = await professorService.getProfessorById(
        id,
        buildProfessorScopeWhere(admin)
    );

    if (!existingProfessor) {
        setFlash(req, 'error', 'Enseignant introuvable ou hors de votre périmètre.');
        return res.redirect('/admin/professors');
    }

    const rawData = sanitizeProfessorInput(req.body);
    const validationError = await validateProfessorInput(rawData, admin, id);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Modifier l’enseignant',
            formAction: `/admin/professors/${id}`,
            submitLabel: 'Enregistrer les modifications',
            professor: buildProfessorForm({ id, ...rawData, isActive: existingProfessor.isActive }),
            error: validationError,
            admin,
        });
    }

    try {
        const effectiveScope = buildEffectiveScope(admin, rawData.campusId, rawData.departmentId);

        const updatedProfessor = await professorService.updateProfessor(id, {
            nom: rawData.nom,
            prenom: rawData.prenom,
            email: rawData.email,
            telephone: rawData.telephone,
            campusId: effectiveScope.campusId,
            departmentId: effectiveScope.departmentId,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.PROFESSOR,
            entityId: updatedProfessor.id,
            action: AUDIT_ACTIONS.UPDATE,
            campusId: updatedProfessor.campusId || null,
            summary: `Modification du compte professeur ${updatedProfessor.prenom} ${updatedProfessor.nom}`,
            beforeData: buildProfessorAuditSnapshot(existingProfessor),
            afterData: buildProfessorAuditSnapshot(updatedProfessor),
        });

        setFlash(req, 'success', 'Enseignant mis à jour avec succès.');
        return res.redirect('/admin/professors');
    } catch (error) {
        console.error('Erreur mise à jour enseignant :', error);

        let message = 'Une erreur est survenue lors de la mise à jour.';
        if (error.code === 'P2002') {
            message = 'Cet email existe déjà.';
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier l’enseignant',
            formAction: `/admin/professors/${id}`,
            submitLabel: 'Enregistrer les modifications',
            professor: buildProfessorForm({ id, ...rawData, isActive: existingProfessor.isActive }),
            error: message,
            admin,
        });
    }
};

exports.toggleActive = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const professor = await professorService.getProfessorById(
            req.params.id,
            buildProfessorScopeWhere(admin)
        );

        if (!professor) {
            setFlash(req, 'error', 'Enseignant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/professors');
        }

        const updatedProfessor = await professorService.toggleProfessorActiveState(
            professor.id,
            !professor.isActive
        );

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.PROFESSOR,
            entityId: updatedProfessor.id,
            action: updatedProfessor.isActive ? AUDIT_ACTIONS.ACTIVATE : AUDIT_ACTIONS.DEACTIVATE,
            campusId: updatedProfessor.campusId || null,
            summary: `${updatedProfessor.isActive ? 'Réactivation' : 'Désactivation'} du compte professeur ${updatedProfessor.prenom} ${updatedProfessor.nom}`,
            beforeData: buildProfessorAuditSnapshot(professor),
            afterData: buildProfessorAuditSnapshot(updatedProfessor),
        });

        setFlash(
            req,
            'success',
            updatedProfessor.isActive
                ? 'Compte enseignant réactivé avec succès.'
                : 'Compte enseignant désactivé avec succès.'
        );

        return res.redirect('/admin/professors');
    } catch (error) {
        console.error('Erreur activation/désactivation enseignant :', error);
        setFlash(req, 'error', 'Impossible de modifier l’état du compte enseignant.');
        return res.redirect('/admin/professors');
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const professor = await professorService.getProfessorById(
            req.params.id,
            buildProfessorScopeWhere(admin)
        );

        if (!professor) {
            setFlash(req, 'error', 'Enseignant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/professors');
        }

        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        await professorService.updateProfessorPassword(professor.id, passwordHash);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.PROFESSOR,
            entityId: professor.id,
            action: AUDIT_ACTIONS.RESET_PASSWORD,
            campusId: professor.campusId || null,
            summary: `Réinitialisation du mot de passe professeur ${professor.prenom} ${professor.nom}`,
            beforeData: buildProfessorAuditSnapshot(professor),
            afterData: {
                ...buildProfessorAuditSnapshot(professor),
                password: '[REDACTED]',
            },
        });

        setFlash(
            req,
            'success',
            `Mot de passe réinitialisé pour ${professor.prenom} ${professor.nom}. Nouveau mot de passe : ${temporaryPassword}`
        );

        return res.redirect('/admin/professors');
    } catch (error) {
        console.error('Erreur reset mot de passe enseignant :', error);
        setFlash(req, 'error', 'Impossible de réinitialiser le mot de passe enseignant.');
        return res.redirect('/admin/professors');
    }
};

exports.destroy = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const professor = await professorService.getProfessorDeletionState(
            req.params.id,
            buildProfessorScopeWhere(admin)
        );

        if (!professor) {
            setFlash(req, 'error', 'Enseignant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/professors');
        }

        if (professor._count.assignments > 0) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : cet enseignant possède encore des affectations. Désactivez son compte plutôt.'
            );
            return res.redirect('/admin/professors');
        }

        await professorService.deleteProfessor(professor.id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.PROFESSOR,
            entityId: professor.id,
            action: AUDIT_ACTIONS.DELETE,
            campusId: professor.campusId || null,
            summary: `Suppression du compte professeur ${professor.prenom} ${professor.nom}`,
            beforeData: buildProfessorAuditSnapshot(professor),
            afterData: null,
        });

        setFlash(req, 'success', `Enseignant ${professor.prenom} ${professor.nom} supprimé.`);
        return res.redirect('/admin/professors');
    } catch (error) {
        console.error('Erreur suppression enseignant :', error);
        setFlash(req, 'error', 'Impossible de supprimer cet enseignant.');
        return res.redirect('/admin/professors');
    }
};