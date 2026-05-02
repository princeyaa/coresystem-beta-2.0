const { setFlash } = require('../utils/flash');
const {
    sanitizeCourseInput,
    buildCourseForm,
    validateCourseData,
} = require('../utils/validators/adminAcademic');

const academicService = require('../services/adminAcademicScopedService');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
} = require('../middlewares/permissions');

function isLocalAdminMisconfigured(admin) {
    return admin && !isGlobalAdmin(admin) && !admin.campusId;
}

function buildClassScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    const where = {
        campusId: admin.campusId,
    };

    if (admin.departmentId) {
        where.departmentId = admin.departmentId;
    }

    return where;
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

function buildCourseScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        program: {
            classes: {
                some: buildClassScopeWhere(admin),
            },
        },
    };
}

const renderForm = async (req, res, options) => {
    const admin = options.admin || (await resolveCurrentAdmin(req));

    const programs = await academicService.getProgramsBasic(
        buildProgramScopeWhere(admin)
    );

    return res.render('admin/courses/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        course: options.course,
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

        const courses = await academicService.getCoursesWithCounts(
            buildCourseScopeWhere(admin)
        );

        return res.render('admin/courses/index', {
            courses,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement cours admin :', error);
        setFlash(req, 'error', 'Impossible de charger les cours.');
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
            pageTitle: 'Nouveau cours',
            formAction: '/admin/courses',
            submitLabel: 'Créer le cours',
            course: buildCourseForm(),
            admin,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire création cours :', error);
        setFlash(req, 'error', 'Impossible de charger le formulaire de création.');
        return res.redirect('/admin/courses');
    }
};

exports.store = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const courseData = sanitizeCourseInput(req.body);
    const validationError = validateCourseData(courseData);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Nouveau cours',
            formAction: '/admin/courses',
            submitLabel: 'Créer le cours',
            course: buildCourseForm(courseData),
            error: validationError,
            admin,
            session: req.session,
        });
    }

    try {
        const program = await academicService.getProgramById(
            courseData.programId,
            buildProgramScopeWhere(admin)
        );

        if (!program) {
            return renderForm(req, res, {
                pageTitle: 'Nouveau cours',
                formAction: '/admin/courses',
                submitLabel: 'Créer le cours',
                course: buildCourseForm(courseData),
                error: 'Le programme sélectionné est introuvable ou hors de votre périmètre.',
                admin,
                session: req.session,
            });
        }

        await academicService.createCourse(courseData);
        setFlash(req, 'success', 'Cours créé avec succès.');
        return res.redirect('/admin/courses');
    } catch (error) {
        console.error('Erreur création cours :', error);

        const message =
            error.code === 'P2002'
                ? 'Ce code de cours existe déjà.'
                : 'Une erreur est survenue lors de la création.';

        return renderForm(req, res, {
            pageTitle: 'Nouveau cours',
            formAction: '/admin/courses',
            submitLabel: 'Créer le cours',
            course: buildCourseForm(courseData),
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

        const course = await academicService.getCourseById(
            req.params.id,
            buildCourseScopeWhere(admin)
        );

        if (!course) {
            setFlash(req, 'error', 'Cours introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/courses');
        }

        return renderForm(req, res, {
            pageTitle: 'Modifier le cours',
            formAction: `/admin/courses/${course.id}`,
            submitLabel: 'Enregistrer les modifications',
            course: buildCourseForm(course),
            admin,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition cours :', error);
        setFlash(req, 'error', 'Impossible de charger ce cours.');
        return res.redirect('/admin/courses');
    }
};

exports.update = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { id } = req.params;
    const courseData = sanitizeCourseInput(req.body);
    const validationError = validateCourseData(courseData);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const existingCourse = await academicService.getCourseById(
        id,
        buildCourseScopeWhere(admin)
    );

    if (!existingCourse) {
        setFlash(req, 'error', 'Cours introuvable ou hors de votre périmètre.');
        return res.redirect('/admin/courses');
    }

    if (validationError) {
        return renderForm(req, res, {
            pageTitle: 'Modifier le cours',
            formAction: `/admin/courses/${id}`,
            submitLabel: 'Enregistrer les modifications',
            course: buildCourseForm(courseData),
            error: validationError,
            admin,
            session: req.session,
        });
    }

    try {
        const program = await academicService.getProgramById(
            courseData.programId,
            buildProgramScopeWhere(admin)
        );

        if (!program) {
            return renderForm(req, res, {
                pageTitle: 'Modifier le cours',
                formAction: `/admin/courses/${id}`,
                submitLabel: 'Enregistrer les modifications',
                course: buildCourseForm(courseData),
                error: 'Le programme sélectionné est introuvable ou hors de votre périmètre.',
                admin,
                session: req.session,
            });
        }

        await academicService.updateCourse(id, courseData);
        setFlash(req, 'success', 'Cours mis à jour avec succès.');
        return res.redirect('/admin/courses');
    } catch (error) {
        console.error('Erreur mise à jour cours :', error);

        const message =
            error.code === 'P2002'
                ? 'Ce code de cours existe déjà.'
                : 'Une erreur est survenue lors de la mise à jour.';

        return renderForm(req, res, {
            pageTitle: 'Modifier le cours',
            formAction: `/admin/courses/${id}`,
            submitLabel: 'Enregistrer les modifications',
            course: buildCourseForm(courseData),
            error: message,
            admin,
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);
    const { id } = req.params;

    try {
        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const course = await academicService.getCourseDeletionState(
            id,
            buildCourseScopeWhere(admin)
        );

        if (!course) {
            setFlash(req, 'error', 'Cours introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/courses');
        }

        const hasDependencies =
            course._count.schedules > 0 ||
            course._count.grades > 0 ||
            course._count.teachingAssignments > 0;

        if (hasDependencies) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : ce cours possède déjà des créneaux, notes ou affectations.'
            );
            return res.redirect('/admin/courses');
        }

        await academicService.deleteCourse(id);
        setFlash(req, 'success', `Cours ${course.code} supprimé.`);
        return res.redirect('/admin/courses');
    } catch (error) {
        console.error('Erreur suppression cours :', error);
        setFlash(req, 'error', 'Impossible de supprimer ce cours.');
        return res.redirect('/admin/courses');
    }
};