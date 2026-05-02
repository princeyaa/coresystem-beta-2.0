const bcrypt = require('bcrypt');

const { setFlash } = require('../utils/flash');
const adminStudentService = require('../services/adminStudentService');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
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
    const normalized = normalizeText(value).toLowerCase();
    return normalized || null;
}

function generateTemporaryPassword() {
    const partA = Math.random().toString(36).slice(2, 6);
    const partB = Date.now().toString(36).slice(-4);
    return `ST-${partA}${partB}`;
}

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

function buildStudentScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        enrollments: {
            some: {
                class: {
                    is: buildClassScopeWhere(admin),
                },
            },
        },
    };
}

function buildProgramScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        classes: {
            some: buildClassScopeWhere(admin),
        },
    };
}

function buildStudentForm(data = {}) {
    return {
        id: data.id || '',
        matricule: data.matricule || '',
        nom: data.nom || '',
        prenom: data.prenom || '',
        email: data.email || '',
        telephone: data.telephone || '',
        academicYear: data.academicYear || '2025-2026',
        programId: data.programId || '',
        classId: data.classId || '',
    };
}

function sanitizeStudentInput(body = {}) {
    return {
        matricule: normalizeText(body.matricule),
        nom: normalizeText(body.nom),
        prenom: normalizeText(body.prenom),
        email: normalizeEmail(body.email),
        telephone: normalizeText(body.telephone) || null,
        academicYear: normalizeText(body.academicYear),
        programId: normalizeText(body.programId),
        classId: normalizeText(body.classId),
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

function buildStudentSearchWhere(rawQuery) {
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
                    { matricule: { contains: term } },
                    { nom: { contains: term } },
                    { prenom: { contains: term } },
                    { email: { contains: term } },
                    { telephone: { contains: term } },
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

function sanitizeEnrollmentStatus(value) {
    const normalized = normalizeText(value);

    if (['all', 'withClass', 'withoutClass'].includes(normalized)) {
        return normalized;
    }

    return 'all';
}

function buildStudentFilterState(query = {}, admin = null) {
    const isSuperAdmin = isGlobalAdmin(admin);

    return {
        academicYear: normalizeText(query.academicYear).slice(0, 9),
        campusId: isSuperAdmin
            ? sanitizeFilterId(query.campusId)
            : (admin && admin.campusId ? admin.campusId : ''),
        departmentId: sanitizeFilterId(query.departmentId),
        programId: sanitizeFilterId(query.programId),
        classId: sanitizeFilterId(query.classId),
        enrollmentStatus: sanitizeEnrollmentStatus(query.enrollmentStatus),
        paymentStatus: 'all',
    };
}

function buildEnrollmentFilterWhere(filters = {}) {
    const enrollmentWhere = {};

    if (filters.academicYear) {
        enrollmentWhere.academicYear = filters.academicYear;
    }

    if (filters.programId) {
        enrollmentWhere.programId = filters.programId;
    }

    if (filters.classId) {
        enrollmentWhere.classId = filters.classId;
    }

    const classWhere = {};

    if (filters.campusId) {
        classWhere.campusId = filters.campusId;
    }

    if (filters.departmentId) {
        classWhere.departmentId = filters.departmentId;
    }

    if (Object.keys(classWhere).length > 0) {
        enrollmentWhere.class = {
            is: classWhere,
        };
    }

    if (Object.keys(enrollmentWhere).length === 0) {
        return {};
    }

    return {
        enrollments: {
            some: enrollmentWhere,
        },
    };
}

function buildEnrollmentStatusWhere(status) {
    if (status === 'withClass') {
        return {
            enrollments: {
                some: {
                    classId: {
                        not: null,
                    },
                },
            },
        };
    }

    if (status === 'withoutClass') {
        return {
            OR: [
                {
                    enrollments: {
                        none: {},
                    },
                },
                {
                    enrollments: {
                        some: {
                            classId: null,
                        },
                    },
                },
            ],
        };
    }

    return {};
}

function buildStudentFiltersWhere(filters = {}) {
    return mergeWhereClauses(
        buildEnrollmentFilterWhere(filters),
        buildEnrollmentStatusWhere(filters.enrollmentStatus)
    );
}

function buildClassFilterOptionsWhere(admin, filters = {}) {
    const classWhere = {
        ...buildClassScopeWhere(admin),
    };

    if (filters.academicYear) {
        classWhere.academicYear = filters.academicYear;
    }

    if (filters.campusId) {
        classWhere.campusId = filters.campusId;
    }

    if (filters.departmentId) {
        classWhere.departmentId = filters.departmentId;
    }

    if (filters.programId) {
        classWhere.programId = filters.programId;
    }

    return classWhere;
}

function hasActiveStudentFilters(searchQuery = '', filters = {}) {
    return Boolean(
        searchQuery ||
        filters.academicYear ||
        filters.departmentId ||
        filters.programId ||
        filters.classId ||
        filters.enrollmentStatus !== 'all' ||
        (filters.campusId && filters.campusId !== '')
    );
}

function getCurrentEnrollment(studentRecord) {
    if (!studentRecord || !studentRecord.enrollments || !studentRecord.enrollments.length) {
        return null;
    }

    return studentRecord.enrollments[0];
}

function buildStudentAuditSnapshot(studentRecord) {
    if (!studentRecord) return null;

    const currentEnrollment = getCurrentEnrollment(studentRecord);

    return {
        id: studentRecord.id,
        matricule: studentRecord.matricule,
        nom: studentRecord.nom,
        prenom: studentRecord.prenom,
        email: studentRecord.email,
        telephone: studentRecord.telephone,
        currentEnrollment: currentEnrollment
            ? {
                academicYear: currentEnrollment.academicYear,
                programId: currentEnrollment.programId,
                classId: currentEnrollment.classId,
                campusId: currentEnrollment.class && currentEnrollment.class.campus
                    ? currentEnrollment.class.campus.id
                    : null,
                campusNom: currentEnrollment.class && currentEnrollment.class.campus
                    ? currentEnrollment.class.campus.nom
                    : null,
                departmentId: currentEnrollment.class && currentEnrollment.class.department
                    ? currentEnrollment.class.department.id
                    : null,
                departmentNom: currentEnrollment.class && currentEnrollment.class.department
                    ? currentEnrollment.class.department.nom
                    : null,
            }
            : null,
    };
}

async function validateStudentData(data, admin, currentStudentId = null) {
    if (
        !data.matricule ||
        !data.nom ||
        !data.prenom ||
        !data.academicYear ||
        !data.programId ||
        !data.classId
    ) {
        return 'Le matricule, le nom, le prénom, l’année académique, le programme et la classe sont obligatoires.';
    }

    const existingByMatricule = await adminStudentService.getStudentByMatricule(data.matricule);

    if (existingByMatricule && existingByMatricule.id !== currentStudentId) {
        return 'Ce matricule existe déjà.';
    }

    if (data.email) {
        const existingByEmail = await adminStudentService.getStudentByEmail(data.email);

        if (existingByEmail && existingByEmail.id !== currentStudentId) {
            return 'Cet email est déjà utilisé.';
        }
    }

    const availableClasses = await adminStudentService.getClassesForStudentForm(
        buildClassScopeWhere(admin)
    );

    const selectedClass = availableClasses.find((item) => item.id === data.classId);

    if (!selectedClass) {
        return 'La classe sélectionnée est introuvable ou hors de votre périmètre.';
    }

    if (selectedClass.programId !== data.programId) {
        return 'La classe sélectionnée ne correspond pas au programme choisi.';
    }

    return null;
}

async function renderForm(req, res, options) {
    const admin = options.admin || (await resolveCurrentAdmin(req));

    const [programs, classes] = await Promise.all([
        adminStudentService.getProgramsForStudentForm(buildProgramScopeWhere(admin)),
        adminStudentService.getClassesForStudentForm(buildClassScopeWhere(admin)),
    ]);

    return res.render('admin/students/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        student: options.student,
        programs,
        classes,
        error: options.error || null,
        session: req.session,
    });
}

exports.index = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const { searchQuery, searchWhere } = buildStudentSearchWhere(req.query.q);
        const filters = buildStudentFilterState(req.query, admin);

        const classOptionsWhere = buildClassFilterOptionsWhere(admin, filters);

        const [
            students,
            programs,
            classes,
            campuses,
            departments,
            academicYears,
        ] = await Promise.all([
            adminStudentService.getStudents(
                mergeWhereClauses(
                    buildStudentScopeWhere(admin),
                    searchWhere,
                    buildStudentFiltersWhere(filters)
                )
            ),
            adminStudentService.getProgramsForStudentForm(buildProgramScopeWhere(admin)),
            adminStudentService.getClassesForStudentForm(classOptionsWhere),
            adminStudentService.getCampusesForStudentFilters(
                isGlobalAdmin(admin)
                    ? {}
                    : { id: admin.campusId }
            ),
            adminStudentService.getDepartmentsForStudentFilters(
                filters.campusId
                    ? { campusId: filters.campusId }
                    : (
                        isGlobalAdmin(admin)
                            ? {}
                            : { campusId: admin.campusId }
                    )
            ),
            adminStudentService.getAcademicYearsForStudentFilters(
                buildClassScopeWhere(admin)
            ),
        ]);

        return res.render('admin/students/index', {
            pageTitle: 'Étudiants',
            students,
            searchQuery,
            filters,
            filterOptions: {
                programs,
                classes,
                campuses,
                departments,
                academicYears,
            },
            isSuperAdmin: isGlobalAdmin(admin),
            hasActiveFilters: hasActiveStudentFilters(searchQuery, filters),
            paymentFilterAvailable: false,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement étudiants admin :', error);
        setFlash(req, 'error', 'Impossible de charger les étudiants.');
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

        const student = await adminStudentService.getStudentDetails(
            req.params.id,
            buildStudentScopeWhere(admin)
        );

        if (!student) {
            setFlash(req, 'error', 'Étudiant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/students');
        }

        const latestStudentAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.STUDENT,
            [student.id]
        );

        const studentTraceMeta = toTraceMeta(
            latestStudentAudits[student.id],
            {
                label: 'Dossier étudiant',
                summary: 'Dossier étudiant consultable',
                actorName: 'Système',
                actorRole: 'SYSTEM',
                createdAt: student.updatedAt || student.createdAt,
            }
        );

        const studentTraceHistory = await getAuditHistory(
            AUDIT_ENTITY_TYPES.STUDENT,
            student.id,
            { limit: 5 }
        );

        return res.render('admin/students/show', {
            pageTitle: `Fiche étudiant — ${student.prenom} ${student.nom}`,
            student,
            studentTraceMeta,
            studentTraceHistory,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement fiche étudiant :', error);
        setFlash(req, 'error', 'Impossible de charger cette fiche étudiant.');
        return res.redirect('/admin/students');
    }
};
exports.createForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    return renderForm(req, res, {
        pageTitle: 'Nouvel étudiant',
        formAction: '/admin/students',
        submitLabel: 'Créer le compte étudiant',
        student: buildStudentForm(),
        admin,
    });
};

exports.store = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const data = sanitizeStudentInput(req.body);
    const validationError = await validateStudentData(data, admin);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Nouvel étudiant',
            formAction: '/admin/students',
            submitLabel: 'Créer le compte étudiant',
            student: buildStudentForm(data),
            error: validationError,
            admin,
        });
    }

    try {
        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        const result = await adminStudentService.createStudentWithEnrollment({
            studentData: {
                matricule: data.matricule,
                nom: data.nom,
                prenom: data.prenom,
                email: data.email,
                telephone: data.telephone,
                password: passwordHash,
            },
            enrollmentData: {
                academicYear: data.academicYear,
                programId: data.programId,
                classId: data.classId,
            },
        });

        const createdStudent = await adminStudentService.getStudentById(
            result.student.id,
            {}
        );

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.STUDENT,
            entityId: result.student.id,
            action: AUDIT_ACTIONS.CREATE,
            summary: `Création du compte étudiant ${data.prenom} ${data.nom}`,
            beforeData: null,
            afterData: buildStudentAuditSnapshot(createdStudent) || {
                matricule: data.matricule,
                nom: data.nom,
                prenom: data.prenom,
                email: data.email,
                telephone: data.telephone,
                academicYear: data.academicYear,
                programId: data.programId,
                classId: data.classId,
            },
        });

        setFlash(
            req,
            'success',
            `Compte étudiant créé. Mot de passe temporaire : ${temporaryPassword}`
        );

        return res.redirect('/admin/students');
    } catch (error) {
        console.error('Erreur création étudiant :', error);

        let message = 'Une erreur est survenue lors de la création du compte étudiant.';
        if (error.code === 'P2002') {
            message = 'Conflit de données : matricule, email ou inscription déjà existante.';
        }

        return renderForm(req, res, {
            pageTitle: 'Nouvel étudiant',
            formAction: '/admin/students',
            submitLabel: 'Créer le compte étudiant',
            student: buildStudentForm(data),
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

        const studentRecord = await adminStudentService.getStudentById(
            req.params.id,
            buildStudentScopeWhere(admin)
        );

        if (!studentRecord) {
            setFlash(req, 'error', 'Étudiant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/students');
        }

        const currentEnrollment = getCurrentEnrollment(studentRecord);

        return renderForm(req, res, {
            pageTitle: 'Modifier un étudiant',
            formAction: `/admin/students/${studentRecord.id}`,
            submitLabel: 'Enregistrer les modifications',
            student: buildStudentForm({
                ...studentRecord,
                academicYear: currentEnrollment ? currentEnrollment.academicYear : '',
                programId: currentEnrollment ? currentEnrollment.programId : '',
                classId: currentEnrollment ? currentEnrollment.classId : '',
            }),
            admin,
        });
    } catch (error) {
        console.error('Erreur formulaire édition étudiant :', error);
        setFlash(req, 'error', 'Impossible de charger cet étudiant.');
        return res.redirect('/admin/students');
    }
};

exports.update = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const { id } = req.params;
    const studentRecord = await adminStudentService.getStudentById(
        id,
        buildStudentScopeWhere(admin)
    );

    if (!studentRecord) {
        setFlash(req, 'error', 'Étudiant introuvable ou hors de votre périmètre.');
        return res.redirect('/admin/students');
    }

    const data = sanitizeStudentInput(req.body);
    const validationError = await validateStudentData(data, admin, id);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Modifier un étudiant',
            formAction: `/admin/students/${id}`,
            submitLabel: 'Enregistrer les modifications',
            student: buildStudentForm({ id, ...data }),
            error: validationError,
            admin,
        });
    }

    try {
        const beforeSnapshot = buildStudentAuditSnapshot(studentRecord);
        const currentEnrollment = getCurrentEnrollment(studentRecord);

        await adminStudentService.updateStudentWithEnrollment({
            studentId: id,
            studentData: {
                matricule: data.matricule,
                nom: data.nom,
                prenom: data.prenom,
                email: data.email,
                telephone: data.telephone,
            },
            enrollmentData: {
                academicYear: data.academicYear,
                programId: data.programId,
                classId: data.classId,
            },
            existingEnrollmentId: currentEnrollment ? currentEnrollment.id : null,
        });

        const updatedStudent = await adminStudentService.getStudentById(id, {});

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.STUDENT,
            entityId: id,
            action: AUDIT_ACTIONS.UPDATE,
            summary: `Modification du compte étudiant ${data.prenom} ${data.nom}`,
            beforeData: beforeSnapshot,
            afterData: buildStudentAuditSnapshot(updatedStudent) || {
                matricule: data.matricule,
                nom: data.nom,
                prenom: data.prenom,
                email: data.email,
                telephone: data.telephone,
                academicYear: data.academicYear,
                programId: data.programId,
                classId: data.classId,
            },
        });

        setFlash(req, 'success', 'Compte étudiant mis à jour avec succès.');
        return res.redirect('/admin/students');
    } catch (error) {
        console.error('Erreur mise à jour étudiant :', error);

        let message = 'Une erreur est survenue lors de la mise à jour du compte étudiant.';
        if (error.code === 'P2002') {
            message = 'Conflit de données : matricule, email ou inscription déjà existante.';
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier un étudiant',
            formAction: `/admin/students/${id}`,
            submitLabel: 'Enregistrer les modifications',
            student: buildStudentForm({ id, ...data }),
            error: message,
            admin,
        });
    }
};

exports.resetPassword = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    try {
        const studentRecord = await adminStudentService.getStudentById(
            req.params.id,
            buildStudentScopeWhere(admin)
        );

        if (!studentRecord) {
            setFlash(req, 'error', 'Étudiant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/students');
        }

        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        await adminStudentService.updateStudentPassword(studentRecord.id, passwordHash);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.STUDENT,
            entityId: studentRecord.id,
            action: AUDIT_ACTIONS.RESET_PASSWORD,
            summary: `Réinitialisation du mot de passe étudiant ${studentRecord.prenom} ${studentRecord.nom}`,
            beforeData: buildStudentAuditSnapshot(studentRecord),
            afterData: {
                ...buildStudentAuditSnapshot(studentRecord),
                password: '[REDACTED]',
            },
        });

        setFlash(
            req,
            'success',
            `Mot de passe réinitialisé pour ${studentRecord.prenom} ${studentRecord.nom}. Nouveau mot de passe : ${temporaryPassword}`
        );

        return res.redirect('/admin/students');
    } catch (error) {
        console.error('Erreur reset mot de passe étudiant :', error);
        setFlash(req, 'error', 'Impossible de réinitialiser le mot de passe étudiant.');
        return res.redirect('/admin/students');
    }
};

exports.destroy = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    try {
        const studentRecord = await adminStudentService.getStudentById(
            req.params.id,
            buildStudentScopeWhere(admin)
        );

        if (!studentRecord) {
            setFlash(req, 'error', 'Étudiant introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/students');
        }

        const hasHistory =
            studentRecord._count.grades > 0 ||
            studentRecord._count.requests > 0;

        if (hasHistory) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : cet étudiant possède déjà des notes ou des demandes. Une future désactivation sera préférable.'
            );
            return res.redirect('/admin/students');
        }

        const beforeSnapshot = buildStudentAuditSnapshot(studentRecord);

        await adminStudentService.deleteStudent(studentRecord.id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.STUDENT,
            entityId: studentRecord.id,
            action: AUDIT_ACTIONS.DELETE,
            summary: `Suppression du compte étudiant ${studentRecord.prenom} ${studentRecord.nom}`,
            beforeData: beforeSnapshot,
            afterData: null,
        });

        setFlash(req, 'success', 'Compte étudiant supprimé avec succès.');
        return res.redirect('/admin/students');
    } catch (error) {
        console.error('Erreur suppression étudiant :', error);
        setFlash(req, 'error', 'Impossible de supprimer cet étudiant.');
        return res.redirect('/admin/students');
    }
};