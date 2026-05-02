const { setFlash } = require('../utils/flash');
const teachingAssignmentService = require('../services/teachingAssignmentService');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
    canAccessScope,
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

function buildClassScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        campusId: admin.campusId,
    };
}

function buildAssignmentScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        class: buildClassScopeWhere(admin),
    };
}

function buildAssignmentAuditSnapshot(assignment) {
    if (!assignment) return null;

    return {
        id: assignment.id,
        academicYear: assignment.academicYear,
        professorId: assignment.professorId || (assignment.professor ? assignment.professor.id : null),
        professorNom: assignment.professor ? `${assignment.professor.prenom} ${assignment.professor.nom}` : null,
        courseId: assignment.courseId || (assignment.course ? assignment.course.id : null),
        courseCode: assignment.course ? assignment.course.code : null,
        classId: assignment.classId || (assignment.class ? assignment.class.id : null),
        classNom: assignment.class ? assignment.class.nom : null,
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

function buildAssignmentSearchWhere(rawQuery) {
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
                    {
                        professor: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        professor: {
                            is: {
                                prenom: { contains: term },
                            },
                        },
                    },
                    {
                        professor: {
                            is: {
                                email: { contains: term },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                code: { contains: term },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                program: {
                                    is: {
                                        filiere: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                    {
                        course: {
                            is: {
                                program: {
                                    is: {
                                        niveau: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                code: { contains: term },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                academicYear: { contains: term },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                campus: {
                                    is: {
                                        nom: { contains: term },
                                    },
                                },
                            },
                        },
                    },
                    {
                        class: {
                            is: {
                                department: {
                                    is: {
                                        nom: { contains: term },
                                    },
                                },
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

function buildAssignmentFilterState(query = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return {
        academicYear: normalizeText(query.academicYear).slice(0, 9),
        campusId: isSuperAdmin
            ? sanitizeFilterId(query.campusId)
            : (admin && admin.campusId ? admin.campusId : ''),
        departmentId: sanitizeFilterId(query.departmentId),
        programId: sanitizeFilterId(query.programId),
        professorId: sanitizeFilterId(query.professorId),
        courseId: sanitizeFilterId(query.courseId),
        classId: sanitizeFilterId(query.classId),
    };
}

function buildAssignmentFiltersWhere(filters = {}) {
    const where = {};

    if (filters.academicYear) {
        where.academicYear = filters.academicYear;
    }

    if (filters.professorId) {
        where.professorId = filters.professorId;
    }

    if (filters.courseId) {
        where.courseId = filters.courseId;
    }

    if (filters.classId) {
        where.classId = filters.classId;
    }

    if (filters.programId) {
        where.course = {
            is: {
                programId: filters.programId,
            },
        };
    }

    const classWhere = {};

    if (filters.campusId) {
        classWhere.campusId = filters.campusId;
    }

    if (filters.departmentId) {
        classWhere.departmentId = filters.departmentId;
    }

    if (Object.keys(classWhere).length > 0) {
        where.class = {
            is: classWhere,
        };
    }

    return where;
}

function uniqueById(items = []) {
    const map = new Map();

    items.forEach((item) => {
        if (item && item.id && !map.has(item.id)) {
            map.set(item.id, item);
        }
    });

    return Array.from(map.values());
}

function getAcademicYearsFromAssignmentsAndClasses(assignments = [], classes = []) {
    return [...new Set([
        ...assignments.map((item) => item.academicYear),
        ...classes.map((item) => item.academicYear),
    ].filter(Boolean))].sort().reverse();
}

function buildAssignmentFilterOptions({
    assignments = [],
    professors = [],
    courses = [],
    classes = [],
    filters = {},
    admin = null,
}) {
    const isSuperAdmin = isGlobalAdmin(admin);

    let scopedClasses = Array.isArray(classes) ? classes : [];

    if (filters.academicYear) {
        scopedClasses = scopedClasses.filter((item) => item.academicYear === filters.academicYear);
    }

    if (filters.campusId) {
        scopedClasses = scopedClasses.filter((item) => item.campusId === filters.campusId);
    }

    if (filters.departmentId) {
        scopedClasses = scopedClasses.filter((item) => item.departmentId === filters.departmentId);
    }

    if (filters.programId) {
        scopedClasses = scopedClasses.filter((item) => item.programId === filters.programId);
    }

    const campuses = uniqueById(
        classes
            .map((item) => item.campus)
            .filter(Boolean)
    );

    const departments = uniqueById(
        classes
            .map((item) => item.department)
            .filter(Boolean)
            .filter((department) => {
                if (!filters.campusId) return true;
                return department.campusId === filters.campusId;
            })
    );

    const programsFromCourses = courses
        .map((course) => course.program)
        .filter(Boolean);

    const programsFromClasses = classes
        .map((academicClass) => academicClass.program)
        .filter(Boolean);

    return {
        academicYears: getAcademicYearsFromAssignmentsAndClasses(assignments, classes),
        campuses: isSuperAdmin ? campuses : campuses.filter((campus) => campus.id === admin.campusId),
        departments,
        programs: uniqueById([...programsFromCourses, ...programsFromClasses]),
        professors,
        courses,
        classes: scopedClasses,
    };
}

function hasActiveAssignmentFilters(searchQuery = '', filters = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return Boolean(
        searchQuery ||
        filters.academicYear ||
        filters.departmentId ||
        filters.programId ||
        filters.professorId ||
        filters.courseId ||
        filters.classId ||
        (isSuperAdmin && filters.campusId)
    );
}
async function renderForm(req, res, options) {
    const admin = options.admin || (await resolveCurrentAdmin(req));
    const classScopeWhere = buildClassScopeWhere(admin);

    const [professors, courses, classes] = await Promise.all([
        teachingAssignmentService.getProfessorsForAssignment(),
        teachingAssignmentService.getCoursesForAssignment(),
        teachingAssignmentService.getClassesForAssignment(classScopeWhere),
    ]);

    return res.render('admin/teachingAssignments/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        assignment: options.assignment,
        professors,
        courses,
        classes,
        error: options.error || null,
        session: req.session,
    });
}

async function validateAssignmentPayload({
    professorId,
    courseId,
    classId,
    academicYear,
    admin,
}) {
    if (!professorId || !courseId || !classId || !academicYear) {
        return {
            ok: false,
            message: 'Veuillez sélectionner le professeur, le cours, la classe et l’année académique.',
        };
    }

    const [professor, course, academicClass] = await Promise.all([
        teachingAssignmentService.getProfessorById(professorId),
        teachingAssignmentService.getCourseById(courseId),
        teachingAssignmentService.getClassById(classId),
    ]);

    if (!professor || !professor.isActive) {
        return {
            ok: false,
            message: 'Le professeur sélectionné est introuvable ou désactivé.',
        };
    }

    if (!course) {
        return {
            ok: false,
            message: 'Le cours sélectionné est introuvable.',
        };
    }

    if (!academicClass) {
        return {
            ok: false,
            message: 'La classe sélectionnée est introuvable.',
        };
    }

    if (!canAccessScope(admin, { campusId: academicClass.campusId })) {
        return {
            ok: false,
            message: 'Accès refusé : vous ne pouvez pas affecter une classe hors de votre campus.',
        };
    }

    if (course.programId !== academicClass.programId) {
        return {
            ok: false,
            message: 'Le cours sélectionné ne correspond pas au programme de cette classe.',
        };
    }

    return {
        ok: true,
        professor,
        course,
        academicClass,
    };
}

exports.index = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const { searchQuery, searchWhere } = buildAssignmentSearchWhere(req.query.q);
        const filters = buildAssignmentFilterState(req.query, admin);
        const classScopeWhere = buildClassScopeWhere(admin);

        const [
            professors,
            courses,
            classes,
        ] = await Promise.all([
            teachingAssignmentService.getProfessorsForAssignment(),
            teachingAssignmentService.getCoursesForAssignment(),
            teachingAssignmentService.getClassesForAssignment(classScopeWhere),
        ]);

        const assignmentWhere = mergeWhereClauses(
            buildAssignmentScopeWhere(admin),
            searchWhere,
            buildAssignmentFiltersWhere(filters)
        );

        const assignments = await teachingAssignmentService.getTeachingAssignments(assignmentWhere);

        const latestAssignmentAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            assignments.map((item) => item.id)
        );

        const assignmentTraceMap = {};
        assignments.forEach((item) => {
            assignmentTraceMap[item.id] = toTraceMeta(
                latestAssignmentAudits[item.id],
                null
            );
        });

        return res.render('admin/teachingAssignments/index', {
            pageTitle: 'Affectations',
            assignments,
            assignmentTraceMap,
            searchQuery,
            filters,
            filterOptions: buildAssignmentFilterOptions({
                assignments,
                professors,
                courses,
                classes,
                filters,
                admin,
            }),
            isSuperAdmin: isGlobalAdmin(admin),
            hasActiveFilters: hasActiveAssignmentFilters(searchQuery, filters, admin),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement affectations admin :', error);
        setFlash(req, 'error', 'Impossible de charger les affectations.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        return renderForm(req, res, {
            pageTitle: 'Nouvelle affectation',
            formAction: '/admin/assignments',
            submitLabel: 'Créer l’affectation',
            assignment: {
                professorId: '',
                courseId: '',
                classId: '',
                academicYear: '2025-2026',
            },
            admin,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire affectation :', error);
        setFlash(req, 'error', 'Impossible de charger le formulaire.');
        return res.redirect('/admin/assignments');
    }
};

exports.store = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { professorId, courseId, classId, academicYear } = req.body;

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const validation = await validateAssignmentPayload({
        professorId,
        courseId,
        classId,
        academicYear,
        admin,
    });

    if (!validation.ok) {
        return renderForm(req, res, {
            pageTitle: 'Nouvelle affectation',
            formAction: '/admin/assignments',
            submitLabel: 'Créer l’affectation',
            assignment: { professorId, courseId, classId, academicYear },
            error: validation.message,
            admin,
        });
    }

    try {
        const createdAssignment = await teachingAssignmentService.createTeachingAssignment({
            professorId,
            courseId,
            classId,
            academicYear,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            entityId: createdAssignment.id,
            action: AUDIT_ACTIONS.CREATE,
            campusId: validation.academicClass.campusId || null,
            summary: `Création d’une affectation pour ${validation.professor.prenom} ${validation.professor.nom}`,
            beforeData: null,
            afterData: {
                id: createdAssignment.id,
                academicYear,
                professorId,
                professorNom: `${validation.professor.prenom} ${validation.professor.nom}`,
                courseId,
                courseCode: validation.course.code,
                classId,
                classNom: validation.academicClass.nom,
            },
        });

        setFlash(req, 'success', 'Affectation créée avec succès.');
        return res.redirect('/admin/assignments');
    } catch (error) {
        console.error('Erreur création affectation :', error);

        let message = 'Une erreur est survenue lors de la création.';
        if (error.code === 'P2002') {
            message = 'Cette affectation existe déjà pour ce professeur, ce cours, cette classe et cette année.';
        }

        return renderForm(req, res, {
            pageTitle: 'Nouvelle affectation',
            formAction: '/admin/assignments',
            submitLabel: 'Créer l’affectation',
            assignment: { professorId, courseId, classId, academicYear },
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

        const assignment = await teachingAssignmentService.getTeachingAssignmentById(
            req.params.id,
            buildAssignmentScopeWhere(admin)
        );

        if (!assignment) {
            setFlash(req, 'error', 'Affectation introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/assignments');
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier l’affectation',
            formAction: `/admin/assignments/${assignment.id}`,
            submitLabel: 'Enregistrer les modifications',
            assignment,
            admin,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition affectation :', error);
        setFlash(req, 'error', 'Impossible de charger cette affectation.');
        return res.redirect('/admin/assignments');
    }
};

exports.update = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { id } = req.params;
    const { professorId, courseId, classId, academicYear } = req.body;

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const existingAssignment = await teachingAssignmentService.getTeachingAssignmentById(
        id,
        buildAssignmentScopeWhere(admin)
    );

    if (!existingAssignment) {
        setFlash(req, 'error', 'Affectation introuvable ou hors de votre périmètre.');
        return res.redirect('/admin/assignments');
    }

    const validation = await validateAssignmentPayload({
        professorId,
        courseId,
        classId,
        academicYear,
        admin,
    });

    if (!validation.ok) {
        return renderForm(req, res, {
            pageTitle: 'Modifier l’affectation',
            formAction: `/admin/assignments/${id}`,
            submitLabel: 'Enregistrer les modifications',
            assignment: { id, professorId, courseId, classId, academicYear },
            error: validation.message,
            admin,
        });
    }

    try {
        await teachingAssignmentService.updateTeachingAssignment(id, {
            professorId,
            courseId,
            classId,
            academicYear,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            entityId: id,
            action: AUDIT_ACTIONS.UPDATE,
            campusId: validation.academicClass.campusId || null,
            summary: `Modification d’une affectation pour ${validation.professor.prenom} ${validation.professor.nom}`,
            beforeData: buildAssignmentAuditSnapshot(existingAssignment),
            afterData: {
                id,
                academicYear,
                professorId,
                professorNom: `${validation.professor.prenom} ${validation.professor.nom}`,
                courseId,
                courseCode: validation.course.code,
                classId,
                classNom: validation.academicClass.nom,
            },
        });

        setFlash(req, 'success', 'Affectation mise à jour avec succès.');
        return res.redirect('/admin/assignments');
    } catch (error) {
        console.error('Erreur mise à jour affectation :', error);

        let message = 'Une erreur est survenue lors de la mise à jour.';
        if (error.code === 'P2002') {
            message = 'Cette affectation existe déjà pour ce professeur, ce cours, cette classe et cette année.';
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier l’affectation',
            formAction: `/admin/assignments/${id}`,
            submitLabel: 'Enregistrer les modifications',
            assignment: { id, professorId, courseId, classId, academicYear },
            error: message,
            admin,
        });
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;

    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const assignment = await teachingAssignmentService.getTeachingAssignmentById(
            id,
            buildAssignmentScopeWhere(admin)
        );

        if (!assignment) {
            setFlash(req, 'error', 'Affectation introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/assignments');
        }

        await teachingAssignmentService.deleteTeachingAssignment(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            entityId: id,
            action: AUDIT_ACTIONS.DELETE,
            campusId: assignment.class ? assignment.class.campusId : null,
            summary: `Suppression d’une affectation ${assignment.professor.prenom} ${assignment.professor.nom} / ${assignment.course.code}`,
            beforeData: buildAssignmentAuditSnapshot(assignment),
            afterData: null,
        });

        setFlash(
            req,
            'success',
            `Affectation supprimée : ${assignment.professor.prenom} ${assignment.professor.nom} - ${assignment.course.code}.`
        );

        return res.redirect('/admin/assignments');
    } catch (error) {
        console.error('Erreur suppression affectation :', error);
        setFlash(req, 'error', 'Impossible de supprimer cette affectation.');
        return res.redirect('/admin/assignments');
    }
};