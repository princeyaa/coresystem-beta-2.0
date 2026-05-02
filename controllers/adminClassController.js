const { setFlash } = require('../utils/flash');
const classService = require('../services/classService');
const campusService = require('../services/campusService');
const departmentService = require('../services/departmentService');
const adminService = require('../services/adminService');
const {
    resolveCurrentAdmin,
    buildAdminScopedWhere,
    canAccessScope,
    isGlobalAdmin,
} = require('../middlewares/permissions');
const {
    safeWriteAuditLog,
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

function isLocalAdminMisconfigured(admin) {
    return admin && !isGlobalAdmin(admin) && !admin.campusId;
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
    if (!campusId || !departmentId) return false;

    const department = await departmentService.getDepartmentById(departmentId);

    if (!department) return false;

    return department.campusId === campusId;
}

function buildClassAuditSnapshot(academicClass) {
    if (!academicClass) return null;

    return {
        id: academicClass.id,
        nom: academicClass.nom,
        code: academicClass.code,
        academicYear: academicClass.academicYear,
        campusId: academicClass.campusId || (academicClass.campus ? academicClass.campus.id : null),
        campusNom: academicClass.campus ? academicClass.campus.nom : null,
        departmentId: academicClass.departmentId || (academicClass.department ? academicClass.department.id : null),
        departmentNom: academicClass.department ? academicClass.department.nom : null,
        programId: academicClass.programId || (academicClass.program ? academicClass.program.id : null),
        programLabel: academicClass.program
            ? `${academicClass.program.filiere} ${academicClass.program.niveau}`
            : null,
    };
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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

function buildClassSearchWhere(rawQuery) {
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
                    { code: { contains: term } },
                    { academicYear: { contains: term } },
                    {
                        program: {
                            is: {
                                filiere: { contains: term },
                            },
                        },
                    },
                    {
                        program: {
                            is: {
                                niveau: { contains: term },
                            },
                        },
                    },
                    {
                        campus: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        department: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                ],
            })),
        },
    };
}
function sanitizeFilterId(value) {
    const normalized = normalizeText(value);

    if (!normalized || normalized === 'all') {
        return '';
    }

    return normalized;
}

function sanitizeClassPopulationStatus(value) {
    const normalized = normalizeText(value);

    if (['all', 'withStudents', 'withoutStudents'].includes(normalized)) {
        return normalized;
    }

    return 'all';
}

function sanitizeClassAssignmentStatus(value) {
    const normalized = normalizeText(value);

    if (['all', 'withAssignments', 'withoutAssignments'].includes(normalized)) {
        return normalized;
    }

    return 'all';
}

function buildClassFilterState(query = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return {
        academicYear: normalizeText(query.academicYear).slice(0, 9),
        campusId: isSuperAdmin
            ? sanitizeFilterId(query.campusId)
            : (admin && admin.campusId ? admin.campusId : ''),
        departmentId: sanitizeFilterId(query.departmentId),
        programId: sanitizeFilterId(query.programId),
        populationStatus: sanitizeClassPopulationStatus(query.populationStatus),
        assignmentStatus: sanitizeClassAssignmentStatus(query.assignmentStatus),
    };
}

function buildClassFiltersWhere(filters = {}) {
    const where = {};

    if (filters.academicYear) {
        where.academicYear = filters.academicYear;
    }

    if (filters.campusId) {
        where.campusId = filters.campusId;
    }

    if (filters.departmentId) {
        where.departmentId = filters.departmentId;
    }

    if (filters.programId) {
        where.programId = filters.programId;
    }

    if (filters.populationStatus === 'withStudents') {
        where.enrollments = {
            some: {},
        };
    }

    if (filters.populationStatus === 'withoutStudents') {
        where.enrollments = {
            none: {},
        };
    }

    if (filters.assignmentStatus === 'withAssignments') {
        where.teachingAssignments = {
            some: {},
        };
    }

    if (filters.assignmentStatus === 'withoutAssignments') {
        where.teachingAssignments = {
            none: {},
        };
    }

    return where;
}

function getAcademicYearsFromClasses(classes = []) {
    return [...new Set(
        classes
            .map((item) => item.academicYear)
            .filter(Boolean)
    )].sort().reverse();
}

function buildClassFilterOptions({
    campuses = [],
    departments = [],
    programs = [],
    classes = [],
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
        programs,
        academicYears: getAcademicYearsFromClasses(classes),
    };
}

function hasActiveClassFilters(searchQuery = '', filters = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return Boolean(
        searchQuery ||
        filters.academicYear ||
        filters.departmentId ||
        filters.programId ||
        filters.populationStatus !== 'all' ||
        filters.assignmentStatus !== 'all' ||
        (isSuperAdmin && filters.campusId)
    );
}
const renderForm = async (req, res, options) => {
    const admin = options.admin || (await resolveCurrentAdmin(req));

    const [allCampuses, allDepartments, programs] = await Promise.all([
        campusService.getCampuses(),
        departmentService.getDepartments(),
        adminService.getProgramsBasic(),
    ]);

    const campuses = filterCampusesByAdmin(allCampuses, admin);
    const departments = filterDepartmentsByAdmin(allDepartments, admin);

    return res.render('admin/classes/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        academicClass: options.academicClass,
        campuses,
        departments,
        programs,
        error: options.error || null,
        session: options.session,
    });
};

exports.index = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const { searchQuery, searchWhere } = buildClassSearchWhere(req.query.q);
        const filters = buildClassFilterState(req.query, admin);

        const scopedWhere = buildAdminScopedWhere(admin);
        const filteredWhere = mergeWhereClauses(
            scopedWhere,
            searchWhere,
            buildClassFiltersWhere(filters)
        );

        const [
            allCampuses,
            allDepartments,
            programs,
            scopedClassesForOptions,
            classes,
        ] = await Promise.all([
            campusService.getCampuses(),
            departmentService.getDepartments(),
            adminService.getProgramsBasic(),
            classService.getClasses(scopedWhere),
            classService.getClasses(filteredWhere),
        ]);

        const latestClassAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.ACADEMIC_CLASS,
            classes.map((item) => item.id)
        );

        const classTraceMap = {};
        classes.forEach((item) => {
            classTraceMap[item.id] = toTraceMeta(
                latestClassAudits[item.id],
                null
            );
        });

        return res.render('admin/classes/index', {
            pageTitle: 'Classes',
            classes,
            classTraceMap,
            searchQuery,
            filters,
            filterOptions: buildClassFilterOptions({
                campuses: allCampuses,
                departments: allDepartments,
                programs,
                classes: scopedClassesForOptions,
                filters,
                admin,
            }),
            isSuperAdmin: isGlobalAdmin(admin),
            hasActiveFilters: hasActiveClassFilters(searchQuery, filters, admin),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement classes admin :', error);
        setFlash(req, 'error', 'Impossible de charger les classes.');
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

        const scopedWhere = buildAdminScopedWhere(admin);
        const academicClass = await classService.getClassDetails(req.params.id, scopedWhere);

        if (!academicClass) {
            setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/classes');
        }

        const studentIds = academicClass.enrollments.map((enrollment) => enrollment.studentId);
        const assignmentIds = academicClass.teachingAssignments.map((assignment) => assignment.id);
        const recentGrades = await classService.getRecentClassGrades(academicClass.id);
        const recentGradeIds = recentGrades.map((grade) => grade.id);

        const [latestClassAuditMap, latestStudentAudits, latestAssignmentAudits, latestGradeAudits] = await Promise.all([
            getLatestAuditMap(AUDIT_ENTITY_TYPES.ACADEMIC_CLASS, [academicClass.id]),
            getLatestAuditMap(AUDIT_ENTITY_TYPES.STUDENT, studentIds),
            getLatestAuditMap(AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT, assignmentIds),
            getLatestAuditMap(AUDIT_ENTITY_TYPES.GRADE, recentGradeIds),
        ]);

        const classTraceMeta = toTraceMeta(
            latestClassAuditMap[academicClass.id],
            null
        );

        const studentTraceMap = {};
        academicClass.enrollments.forEach((enrollment) => {
            studentTraceMap[enrollment.studentId] = toTraceMeta(
                latestStudentAudits[enrollment.studentId],
                null
            );
        });

        const assignmentTraceMap = {};
        academicClass.teachingAssignments.forEach((assignment) => {
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

        return res.render('admin/classes/show', {
            pageTitle: `Classe - ${academicClass.nom}`,
            academicClass,
            recentGrades,
            classTraceMeta,
            studentTraceMap,
            assignmentTraceMap,
            gradeTraceMap,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement détail classe :', error);
        setFlash(req, 'error', 'Impossible de charger cette classe.');
        return res.redirect('/admin/classes');
    }
};

exports.createForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    return renderForm(req, res, {
        pageTitle: 'Nouvelle classe',
        formAction: '/admin/classes',
        submitLabel: 'Créer la classe',
        academicClass: {
            nom: '',
            code: '',
            academicYear: '',
            campusId: isGlobalAdmin(admin) ? '' : admin.campusId || '',
            departmentId: '',
            programId: '',
        },
        admin,
        session: req.session,
    });
};

exports.store = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { nom, code, academicYear, campusId, departmentId, programId } = req.body;

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    if (!nom || !academicYear || !campusId || !departmentId || !programId) {
        return renderForm(req, res, {
            pageTitle: 'Nouvelle classe',
            formAction: '/admin/classes',
            submitLabel: 'Créer la classe',
            academicClass: { nom, code, academicYear, campusId, departmentId, programId },
            error: 'Veuillez remplir tous les champs obligatoires.',
            admin,
            session: req.session,
        });
    }

    if (!canAccessScope(admin, { campusId })) {
        return renderForm(req, res, {
            pageTitle: 'Nouvelle classe',
            formAction: '/admin/classes',
            submitLabel: 'Créer la classe',
            academicClass: { nom, code, academicYear, campusId, departmentId, programId },
            error: 'Accès refusé : vous ne pouvez pas créer une classe hors de votre campus.',
            admin,
            session: req.session,
        });
    }

    const departmentMatchesCampus = await validateDepartmentBelongsToCampus(campusId, departmentId);

    if (!departmentMatchesCampus) {
        return renderForm(req, res, {
            pageTitle: 'Nouvelle classe',
            formAction: '/admin/classes',
            submitLabel: 'Créer la classe',
            academicClass: { nom, code, academicYear, campusId, departmentId, programId },
            error: 'Le département sélectionné ne correspond pas au campus choisi.',
            admin,
            session: req.session,
        });
    }

    try {
        const createdClass = await classService.createClass({
            nom,
            code: code || null,
            academicYear,
            campusId,
            departmentId,
            programId,
        });

        const fullClass = await classService.getClassById(createdClass.id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ACADEMIC_CLASS,
            entityId: createdClass.id,
            action: AUDIT_ACTIONS.CREATE,
            campusId,
            summary: `Création de la classe ${nom}`,
            beforeData: null,
            afterData: buildClassAuditSnapshot(fullClass) || {
                nom,
                code,
                academicYear,
                campusId,
                departmentId,
                programId,
            },
        });

        setFlash(req, 'success', 'Classe créée avec succès.');
        return res.redirect('/admin/classes');
    } catch (error) {
        console.error('Erreur création classe :', error);

        let message = 'Une erreur est survenue lors de la création.';
        if (error.code === 'P2002') {
            message = 'Ce code ou ce nom de classe existe déjà.';
        }

        return renderForm(req, res, {
            pageTitle: 'Nouvelle classe',
            formAction: '/admin/classes',
            submitLabel: 'Créer la classe',
            academicClass: { nom, code, academicYear, campusId, departmentId, programId },
            error: message,
            admin,
            session: req.session,
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

        const scopedWhere = buildAdminScopedWhere(admin);
        const academicClass = await classService.getClassById(req.params.id, scopedWhere);

        if (!academicClass) {
            setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/classes');
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier la classe',
            formAction: `/admin/classes/${academicClass.id}`,
            submitLabel: 'Enregistrer les modifications',
            academicClass,
            admin,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition classe :', error);
        setFlash(req, 'error', 'Impossible de charger cette classe.');
        return res.redirect('/admin/classes');
    }
};

exports.update = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { id } = req.params;
    const { nom, code, academicYear, campusId, departmentId, programId } = req.body;

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const scopedWhere = buildAdminScopedWhere(admin);
    const existingClass = await classService.getClassById(id, scopedWhere);

    if (!existingClass) {
        setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
        return res.redirect('/admin/classes');
    }

    if (!nom || !academicYear || !campusId || !departmentId || !programId) {
        return renderForm(req, res, {
            pageTitle: 'Modifier la classe',
            formAction: `/admin/classes/${id}`,
            submitLabel: 'Enregistrer les modifications',
            academicClass: { id, nom, code, academicYear, campusId, departmentId, programId },
            error: 'Veuillez remplir tous les champs obligatoires.',
            admin,
            session: req.session,
        });
    }

    if (!canAccessScope(admin, { campusId })) {
        return renderForm(req, res, {
            pageTitle: 'Modifier la classe',
            formAction: `/admin/classes/${id}`,
            submitLabel: 'Enregistrer les modifications',
            academicClass: { id, nom, code, academicYear, campusId, departmentId, programId },
            error: 'Accès refusé : vous ne pouvez pas déplacer cette classe hors de votre campus.',
            admin,
            session: req.session,
        });
    }

    const departmentMatchesCampus = await validateDepartmentBelongsToCampus(campusId, departmentId);

    if (!departmentMatchesCampus) {
        return renderForm(req, res, {
            pageTitle: 'Modifier la classe',
            formAction: `/admin/classes/${id}`,
            submitLabel: 'Enregistrer les modifications',
            academicClass: { id, nom, code, academicYear, campusId, departmentId, programId },
            error: 'Le département sélectionné ne correspond pas au campus choisi.',
            admin,
            session: req.session,
        });
    }

    try {
        const updatedClass = await classService.updateClass(id, {
            nom,
            code: code || null,
            academicYear,
            campusId,
            departmentId,
            programId,
        });

        const fullUpdatedClass = await classService.getClassById(updatedClass.id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ACADEMIC_CLASS,
            entityId: id,
            action: AUDIT_ACTIONS.UPDATE,
            campusId,
            summary: `Modification de la classe ${nom}`,
            beforeData: buildClassAuditSnapshot(existingClass),
            afterData: buildClassAuditSnapshot(fullUpdatedClass) || {
                nom,
                code,
                academicYear,
                campusId,
                departmentId,
                programId,
            },
        });

        setFlash(req, 'success', 'Classe mise à jour avec succès.');
        return res.redirect('/admin/classes');
    } catch (error) {
        console.error('Erreur mise à jour classe :', error);

        let message = 'Une erreur est survenue lors de la mise à jour.';
        if (error.code === 'P2002') {
            message = 'Ce code ou ce nom de classe existe déjà.';
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier la classe',
            formAction: `/admin/classes/${id}`,
            submitLabel: 'Enregistrer les modifications',
            academicClass: { id, nom, code, academicYear, campusId, departmentId, programId },
            error: message,
            admin,
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { id } = req.params;

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    try {
        const scopedWhere = buildAdminScopedWhere(admin);
        const academicClass = await classService.getClassDeletionState(id, scopedWhere);

        if (!academicClass) {
            setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/classes');
        }

        const hasDependencies =
            academicClass._count.enrollments > 0 ||
            academicClass._count.teachingAssignments > 0;

        if (hasDependencies) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : cette classe possède déjà des inscriptions ou des affectations.'
            );
            return res.redirect('/admin/classes');
        }

        await classService.deleteClass(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ACADEMIC_CLASS,
            entityId: id,
            action: AUDIT_ACTIONS.DELETE,
            campusId: academicClass.campusId || null,
            summary: `Suppression de la classe ${academicClass.nom}`,
            beforeData: buildClassAuditSnapshot(academicClass),
            afterData: null,
        });

        setFlash(req, 'success', `Classe ${academicClass.nom} supprimée.`);
        return res.redirect('/admin/classes');
    } catch (error) {
        console.error('Erreur suppression classe :', error);
        setFlash(req, 'error', 'Impossible de supprimer cette classe.');
        return res.redirect('/admin/classes');
    }
};