const { setFlash } = require('../utils/flash');
const {
    ALLOWED_EVAL_TYPES,
    sanitizeGradeInput,
    buildGradeForm,
    validateGradeData,
} = require('../utils/validators/adminManagement');

const adminGradeService = require('../services/adminGradeService');
const { PUBLISHED_GRADE_LOCK_ERROR } = adminGradeService;
const classService = require('../services/classService');
const {
    resolveCurrentAdmin,
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

    const classScopeWhere = buildClassScopeWhere(admin);

    return {
        enrollments: {
            some: {
                class: {
                    is: classScopeWhere,
                },
            },
        },
    };
}

function buildCourseScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    const classScopeWhere = buildClassScopeWhere(admin);

    return {
        program: {
            classes: {
                some: classScopeWhere,
            },
        },
    };
}

function buildGradeScopeWhere(admin, classId = null) {
    const baseWhere = !admin || isGlobalAdmin(admin)
        ? {}
        : {
            student: {
                enrollments: {
                    some: {
                        class: {
                            is: buildClassScopeWhere(admin),
                        },
                    },
                },
            },
        };

    if (!classId) {
        return baseWhere;
    }

    if (!baseWhere.student) {
        return {
            student: {
                enrollments: {
                    some: {
                        classId,
                    },
                },
            },
        };
    }

    return {
        student: {
            enrollments: {
                some: {
                    classId,
                    class: {
                        is: buildClassScopeWhere(admin),
                    },
                },
            },
        },
    };
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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
function getStudentCampusId(student) {
    if (!student || !student.enrollments || !student.enrollments.length) {
        return null;
    }

    const firstEnrollment = student.enrollments[0];
    if (!firstEnrollment.class || !firstEnrollment.class.campus) {
        return null;
    }

    return firstEnrollment.class.campus.id;
}

function buildGradeAuditSnapshot(grade) {
    if (!grade) return null;

    return {
        id: grade.id,
        studentId: grade.studentId || (grade.student ? grade.student.id : null),
        studentNom: grade.student ? `${grade.student.prenom} ${grade.student.nom}` : null,
        courseId: grade.courseId || (grade.course ? grade.course.id : null),
        courseCode: grade.course ? grade.course.code : null,
        typeEvaluation: grade.typeEvaluation,
        valeur: grade.valeur,
        published: grade.published,
    };
}

const renderForm = async (req, res, options) => {
    const admin = options.admin || (await resolveCurrentAdmin(req));

    const studentScopeWhere = buildStudentScopeWhere(admin);
    const courseScopeWhere = buildCourseScopeWhere(admin);

    const [students, courses] = await Promise.all([
        adminGradeService.getStudentsForGradeForm(studentScopeWhere),
        adminGradeService.getCoursesForGradeForm(courseScopeWhere),
    ]);

    return res.render('admin/grades/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        grade: options.grade,
        students,
        courses,
        allowedEvalTypes: ALLOWED_EVAL_TYPES,
        error: options.error || null,
        classContext: options.classContext || null,
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

        const classId = typeof req.query.classId === 'string' && req.query.classId.trim()
            ? req.query.classId.trim()
            : null;

        let classContext = null;
        let classCourses = [];

        if (classId) {
            classContext = await classService.getClassById(
                classId,
                buildClassScopeWhere(admin)
            );

            if (!classContext) {
                setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
                return res.redirect('/admin/classes');
            }

            classCourses = await adminGradeService.getCoursesForGradeForm({
                programId: classContext.programId,
            });
        }

        const grades = await adminGradeService.getGradesWithRelations(
            buildGradeScopeWhere(admin, classId)
        );

        const latestGradeAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.GRADE,
            grades.map((grade) => grade.id)
        );

        const gradeTraceMap = {};
        grades.forEach((grade) => {
            gradeTraceMap[grade.id] = toTraceMeta(
                latestGradeAudits[grade.id],
                null
            );
        });

        return res.render('admin/grades/index', {
            grades,
            gradeTraceMap,
            classContext,
            classCourses,
            allowedEvalTypes: ALLOWED_EVAL_TYPES,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement notes admin :', error);
        setFlash(req, 'error', 'Impossible de charger les notes.');
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

        const classId = typeof req.query.classId === 'string' && req.query.classId.trim()
            ? req.query.classId.trim()
            : null;

        let classContext = null;

        if (classId) {
            classContext = await classService.getClassById(
                classId,
                buildClassScopeWhere(admin)
            );

            if (!classContext) {
                setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
                return res.redirect('/admin/classes');
            }
        }

        const [students, courses] = await Promise.all([
            adminGradeService.getStudentsForGradeForm(buildStudentScopeWhere(admin)),
            adminGradeService.getCoursesForGradeForm(buildCourseScopeWhere(admin)),
        ]);

        if (!students.length) {
            setFlash(req, 'error', 'Crée d’abord au moins un étudiant dans ton périmètre avant d’ajouter une note.');
            return res.redirect('/admin/students');
        }

        if (!courses.length) {
            setFlash(req, 'error', 'Crée d’abord au moins un cours dans ton périmètre avant d’ajouter une note.');
            return res.redirect('/admin/classes');
        }

        return res.render('admin/grades/form', {
            pageTitle: 'Nouvelle note',
            formAction: '/admin/grades',
            submitLabel: 'Créer la note',
            grade: buildGradeForm({
                classId: classContext ? classContext.id : '',
            }),
            students,
            courses,
            allowedEvalTypes: ALLOWED_EVAL_TYPES,
            error: null,
            classContext,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire création note :', error);
        setFlash(req, 'error', 'Impossible de charger le formulaire de création.');
        return res.redirect('/admin/grades');
    }
};

exports.store = async (req, res) => {
    const gradeData = sanitizeGradeInput(req.body);
    const validationError = validateGradeData(gradeData);
    const admin = await resolveCurrentAdmin(req);

    const classId = typeof req.body.classId === 'string' && req.body.classId.trim()
        ? req.body.classId.trim()
        : null;

    let classContext = null;
    if (classId) {
        classContext = await classService.getClassById(
            classId,
            buildClassScopeWhere(admin)
        );
    }

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Nouvelle note',
            formAction: '/admin/grades',
            submitLabel: 'Créer la note',
            grade: buildGradeForm({ ...gradeData, classId }),
            error: validationError,
            admin,
            classContext,
            session: req.session,
        });
    }

    try {
        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const consistency = await adminGradeService.studentBelongsToCourseProgram(
            gradeData.studentId,
            gradeData.courseId,
            buildStudentScopeWhere(admin)
        );

        if (!consistency.ok) {
            return renderForm(req, res, {
                pageTitle: 'Nouvelle note',
                formAction: '/admin/grades',
                submitLabel: 'Créer la note',
                grade: buildGradeForm({ ...gradeData, classId }),
                error: consistency.message,
                admin,
                classContext,
                session: req.session,
            });
        }

        const createdGrade = await adminGradeService.createGrade(gradeData);
        const fullGrade = await adminGradeService.getGradeById(
            createdGrade.id,
            buildGradeScopeWhere(admin)
        );

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.GRADE,
            entityId: createdGrade.id,
            action: AUDIT_ACTIONS.CREATE,
            campusId: fullGrade ? getStudentCampusId(fullGrade.student) : null,
            summary: `Création d’une note ${gradeData.typeEvaluation}`,
            beforeData: null,
            afterData: buildGradeAuditSnapshot(fullGrade) || gradeData,
        });

        setFlash(req, 'success', 'Note créée avec succès.');

        if (classId) {
            return res.redirect(`/admin/grades?classId=${classId}`);
        }

        return res.redirect('/admin/grades');
    } catch (error) {
        console.error('Erreur création note :', error);

        if (error.code === 'P2002') {
            return renderForm(req, res, {
                pageTitle: 'Nouvelle note',
                formAction: '/admin/grades',
                submitLabel: 'Créer la note',
                grade: buildGradeForm({ ...gradeData, classId }),
                error: 'Cette note existe déjà pour cet étudiant, ce cours et ce type d’évaluation.',
                admin,
                classContext,
                session: req.session,
            });
        }

        return renderForm(req, res, {
            pageTitle: 'Nouvelle note',
            formAction: '/admin/grades',
            submitLabel: 'Créer la note',
            grade: buildGradeForm({ ...gradeData, classId }),
            error: 'Une erreur est survenue lors de la création.',
            admin,
            classContext,
            session: req.session,
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);
        const grade = await adminGradeService.getGradeById(
            req.params.id,
            buildGradeScopeWhere(admin)
        );

        if (!grade) {
            setFlash(req, 'error', 'Note introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/grades');
        }

        if (grade.published) {
            setFlash(
                req,
                'error',
                'Note déjà publiée, impossible de modifier. Veuillez d’abord la dépublier.'
            );
            return res.redirect('/admin/grades');
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier la note',
            formAction: `/admin/grades/${grade.id}`,
            submitLabel: 'Enregistrer les modifications',
            grade: buildGradeForm(grade),
            admin,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition note :', error);
        setFlash(req, 'error', 'Impossible de charger cette note.');
        return res.redirect('/admin/grades');
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const gradeData = sanitizeGradeInput(req.body);
    const validationError = validateGradeData(gradeData);
    const admin = await resolveCurrentAdmin(req);

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Modifier la note',
            formAction: `/admin/grades/${id}`,
            submitLabel: 'Enregistrer les modifications',
            grade: buildGradeForm(gradeData),
            error: validationError,
            admin,
            session: req.session,
        });
    }

    try {
        const existingGrade = await adminGradeService.getGradeById(
            id,
            buildGradeScopeWhere(admin)
        );

        if (existingGrade.published) {
            setFlash(
                req,
                'error',
                'Note déjà publiée, impossible de modifier. Veuillez d’abord la dépublier.'
            );
            return res.redirect('/admin/grades');
        }

        const consistency = await adminGradeService.studentBelongsToCourseProgram(
            gradeData.studentId,
            gradeData.courseId,
            buildStudentScopeWhere(admin)
        );

        if (!consistency.ok) {
            return renderForm(req, res, {
                pageTitle: 'Modifier la note',
                formAction: `/admin/grades/${id}`,
                submitLabel: 'Enregistrer les modifications',
                grade: buildGradeForm(gradeData),
                error: consistency.message,
                admin,
                session: req.session,
            });
        }

        await adminGradeService.updateGrade(id, gradeData);

        const updatedGrade = await adminGradeService.getGradeById(
            id,
            buildGradeScopeWhere(admin)
        );

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.GRADE,
            entityId: id,
            action: AUDIT_ACTIONS.UPDATE,
            campusId: updatedGrade ? getStudentCampusId(updatedGrade.student) : null,
            summary: `Modification d’une note ${updatedGrade ? updatedGrade.typeEvaluation : gradeData.typeEvaluation}`,
            beforeData: buildGradeAuditSnapshot(existingGrade),
            afterData: buildGradeAuditSnapshot(updatedGrade) || gradeData,
        });

        setFlash(req, 'success', 'Note mise à jour avec succès.');
        return res.redirect('/admin/grades');
    } catch (error) {
        console.error('Erreur mise à jour note :', error);

        if (error.code === 'P2025') {
            setFlash(req, 'error', 'Note introuvable.');
            return res.redirect('/admin/grades');
        }
        if (error.code === PUBLISHED_GRADE_LOCK_ERROR) {
            setFlash(
                req,
                'error',
                error.message || 'Note déjà publiée, modification impossible.'
            );
            return res.redirect('/admin/grades');
        }

        if (error.code === 'P2002') {
            return renderForm(req, res, {
                pageTitle: 'Modifier la note',
                formAction: `/admin/grades/${id}`,
                submitLabel: 'Enregistrer les modifications',
                grade: buildGradeForm(gradeData),
                error: 'Cette note existe déjà pour cet étudiant, ce cours et ce type d’évaluation.',
                admin,
                session: req.session,
            });
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier la note',
            formAction: `/admin/grades/${id}`,
            submitLabel: 'Enregistrer les modifications',
            grade: buildGradeForm(gradeData),
            error: 'Une erreur est survenue lors de la mise à jour.',
            admin,
            session: req.session,
        });
    }
};

exports.togglePublish = async (req, res) => {
    const { id } = req.params;

    try {
        const admin = await resolveCurrentAdmin(req);
        const grade = await adminGradeService.getGradeWithPublishContext(
            id,
            buildGradeScopeWhere(admin)
        );

        if (!grade) {
            setFlash(req, 'error', 'Note introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/grades');
        }

        await adminGradeService.toggleGradePublish(id, grade.published);
        const publishedAfter = !grade.published;

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.GRADE,
            entityId: id,
            action: publishedAfter ? AUDIT_ACTIONS.PUBLISH : AUDIT_ACTIONS.UNPUBLISH,
            campusId:
                grade.student &&
                    grade.student.enrollments &&
                    grade.student.enrollments[0] &&
                    grade.student.enrollments[0].class
                    ? grade.student.enrollments[0].class.campusId
                    : null,
            summary: `${publishedAfter ? 'Publication' : 'Dépublication'} d’une note pour ${grade.student.prenom} ${grade.student.nom}`,
            beforeData: {
                id: grade.id,
                studentId: grade.studentId,
                courseId: grade.courseId,
                published: grade.published,
            },
            afterData: {
                id: grade.id,
                studentId: grade.studentId,
                courseId: grade.courseId,
                published: publishedAfter,
            },
        });

        setFlash(
            req,
            'success',
            publishedAfter
                ? `Note publiée pour ${grade.student.prenom} ${grade.student.nom} (${grade.course.code}).`
                : `Note dépubliée pour ${grade.student.prenom} ${grade.student.nom} (${grade.course.code}).`
        );

        return res.redirect('/admin/grades');
    } catch (error) {
        console.error('Erreur publication note :', error);
        setFlash(req, 'error', 'Impossible de modifier l’état de publication.');
        return res.redirect('/admin/grades');
    }
};
exports.publishBatch = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const classId = normalizeText(req.body.classId);
    const courseId = normalizeText(req.body.courseId);
    const typeEvaluation = normalizeText(req.body.typeEvaluation).toUpperCase();

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    if (!classId || !courseId || !typeEvaluation) {
        setFlash(req, 'error', 'Classe, cours et type d’évaluation sont obligatoires.');
        return res.redirect('/admin/grades');
    }

    if (!ALLOWED_EVAL_TYPES.includes(typeEvaluation)) {
        setFlash(req, 'error', 'Type d’évaluation invalide.');
        return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
    }

    try {
        const classContext = await classService.getClassById(
            classId,
            buildClassScopeWhere(admin)
        );

        if (!classContext) {
            setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/classes');
        }

        const matchingCourses = await adminGradeService.getCoursesForGradeForm({
            id: courseId,
            programId: classContext.programId,
        });

        const selectedCourse = matchingCourses[0];

        if (!selectedCourse) {
            setFlash(req, 'error', 'Cours introuvable dans le programme de cette classe.');
            return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
        }

        const candidateGrades = await adminGradeService.getGradesWithRelations(
            mergeWhereClauses(
                buildGradeScopeWhere(admin, classId),
                {
                    courseId,
                    typeEvaluation,
                    published: false,
                }
            )
        );

        if (!candidateGrades.length) {
            setFlash(
                req,
                'success',
                `Aucune note brouillon à publier pour ${selectedCourse.code} (${typeEvaluation}).`
            );
            return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
        }

        const ids = candidateGrades.map((grade) => grade.id);

        await adminGradeService.publishGradesBatch(ids);

        for (const grade of candidateGrades) {
            const beforeSnapshot = buildGradeAuditSnapshot(grade);
            const afterSnapshot = {
                ...beforeSnapshot,
                published: true,
            };

            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.GRADE,
                entityId: grade.id,
                action: AUDIT_ACTIONS.PUBLISH,
                campusId: getStudentCampusId(grade.student),
                summary: `Publication batch d’une note ${grade.typeEvaluation} pour ${grade.student.prenom} ${grade.student.nom}`,
                beforeData: beforeSnapshot,
                afterData: afterSnapshot,
            });
        }

        setFlash(
            req,
            'success',
            `${candidateGrades.length} note(s) publiée(s) pour ${selectedCourse.code} (${typeEvaluation}) dans la classe ${classContext.nom}.`
        );

        return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
    } catch (error) {
        console.error('Erreur publication batch des notes :', error);
        setFlash(req, 'error', 'Impossible de publier ce lot de notes.');
        return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
    }
};
exports.unpublishBatch = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const classId = normalizeText(req.body.classId);
    const courseId = normalizeText(req.body.courseId);
    const typeEvaluation = normalizeText(req.body.typeEvaluation).toUpperCase();

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    if (!classId || !courseId || !typeEvaluation) {
        setFlash(req, 'error', 'Classe, cours et type d’évaluation sont obligatoires.');
        return res.redirect('/admin/grades');
    }

    if (!ALLOWED_EVAL_TYPES.includes(typeEvaluation)) {
        setFlash(req, 'error', 'Type d’évaluation invalide.');
        return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
    }

    try {
        const classContext = await classService.getClassById(
            classId,
            buildClassScopeWhere(admin)
        );

        if (!classContext) {
            setFlash(req, 'error', 'Classe introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/classes');
        }

        const matchingCourses = await adminGradeService.getCoursesForGradeForm({
            id: courseId,
            programId: classContext.programId,
        });

        const selectedCourse = matchingCourses[0];

        if (!selectedCourse) {
            setFlash(req, 'error', 'Cours introuvable dans le programme de cette classe.');
            return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
        }

        const candidateGrades = await adminGradeService.getGradesWithRelations(
            mergeWhereClauses(
                buildGradeScopeWhere(admin, classId),
                {
                    courseId,
                    typeEvaluation,
                    published: true,
                }
            )
        );

        if (!candidateGrades.length) {
            setFlash(
                req,
                'success',
                `Aucune note publiée à dépublier pour ${selectedCourse.code} (${typeEvaluation}).`
            );
            return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
        }

        const ids = candidateGrades.map((grade) => grade.id);

        await adminGradeService.unpublishGradesBatch(ids);

        for (const grade of candidateGrades) {
            const beforeSnapshot = buildGradeAuditSnapshot(grade);
            const afterSnapshot = {
                ...beforeSnapshot,
                published: false,
            };

            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.GRADE,
                entityId: grade.id,
                action: AUDIT_ACTIONS.UNPUBLISH,
                campusId: getStudentCampusId(grade.student),
                summary: `Dépublication batch d’une note ${grade.typeEvaluation} pour ${grade.student.prenom} ${grade.student.nom}`,
                beforeData: beforeSnapshot,
                afterData: afterSnapshot,
            });
        }

        setFlash(
            req,
            'success',
            `${candidateGrades.length} note(s) dépubliée(s) pour ${selectedCourse.code} (${typeEvaluation}) dans la classe ${classContext.nom}.`
        );

        return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
    } catch (error) {
        console.error('Erreur dépublication batch des notes :', error);
        setFlash(req, 'error', 'Impossible de dépublier ce lot de notes.');
        return res.redirect(`/admin/grades?classId=${encodeURIComponent(classId)}`);
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;

    try {
        const admin = await resolveCurrentAdmin(req);
        const grade = await adminGradeService.getGradeById(
            id,
            buildGradeScopeWhere(admin)
        );

        if (!grade) {
            setFlash(req, 'error', 'Note introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/grades');
        }

        await adminGradeService.deleteGrade(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.GRADE,
            entityId: id,
            action: AUDIT_ACTIONS.DELETE,
            campusId: getStudentCampusId(grade.student),
            summary: `Suppression d’une note ${grade.typeEvaluation}`,
            beforeData: buildGradeAuditSnapshot(grade),
            afterData: null,
        });

        setFlash(req, 'success', 'Note supprimée avec succès.');
        return res.redirect('/admin/grades');
    } catch (error) {
        console.error('Erreur suppression note :', error);

        if (error.code === PUBLISHED_GRADE_LOCK_ERROR) {
            setFlash(
                req,
                'error',
                error.message || 'Note déjà publiée, suppression impossible.'
            );
            return res.redirect('/admin/grades');
        }

        setFlash(req, 'error', 'Impossible de supprimer cette note.');
        return res.redirect('/admin/grades');
    }
};