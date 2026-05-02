const { setFlash } = require('../utils/flash');
const {
    sanitizeProgramInput,
    buildProgramForm,
    validateProgramData,
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

function ensureCanWriteProgram(req, res, admin) {
    if (isGlobalAdmin(admin)) {
        return true;
    }

    setFlash(
        req,
        'error',
        'Action réservée au super administrateur : le modèle Programme est global pour le moment.'
    );
    res.redirect('/admin/programs');
    return false;
}

const renderForm = (res, options) => {
    return res.render('admin/programs/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        program: options.program,
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

        const programs = await academicService.getProgramsWithCounts(
            buildProgramScopeWhere(admin)
        );

        return res.render('admin/programs/index', {
            programs,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement programmes admin :', error);
        setFlash(req, 'error', 'Impossible de charger les programmes.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (!ensureCanWriteProgram(req, res, admin)) return;

    return renderForm(res, {
        pageTitle: 'Nouveau programme',
        formAction: '/admin/programs',
        submitLabel: 'Créer le programme',
        program: buildProgramForm(),
        session: req.session,
    });
};

exports.store = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (!ensureCanWriteProgram(req, res, admin)) return;

    const programData = sanitizeProgramInput(req.body);
    const validationError = validateProgramData(programData);

    if (validationError) {
        return renderForm(res, {
            pageTitle: 'Nouveau programme',
            formAction: '/admin/programs',
            submitLabel: 'Créer le programme',
            program: buildProgramForm(programData),
            error: validationError,
            session: req.session,
        });
    }

    try {
        await academicService.createProgram(programData);
        setFlash(req, 'success', 'Programme créé avec succès.');
        return res.redirect('/admin/programs');
    } catch (error) {
        console.error('Erreur création programme :', error);

        const message =
            error.code === 'P2002'
                ? 'Ce couple filière / niveau existe déjà.'
                : 'Une erreur est survenue lors de la création.';

        return renderForm(res, {
            pageTitle: 'Nouveau programme',
            formAction: '/admin/programs',
            submitLabel: 'Créer le programme',
            program: buildProgramForm(programData),
            error: message,
            session: req.session,
        });
    }
};

exports.editForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (!ensureCanWriteProgram(req, res, admin)) return;

    try {
        const program = await academicService.getProgramById(req.params.id);

        if (!program) {
            setFlash(req, 'error', 'Programme introuvable.');
            return res.redirect('/admin/programs');
        }

        return renderForm(res, {
            pageTitle: 'Modifier le programme',
            formAction: `/admin/programs/${program.id}`,
            submitLabel: 'Enregistrer les modifications',
            program: buildProgramForm(program),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition programme :', error);
        setFlash(req, 'error', 'Impossible de charger ce programme.');
        return res.redirect('/admin/programs');
    }
};

exports.update = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (!ensureCanWriteProgram(req, res, admin)) return;

    const { id } = req.params;
    const programData = sanitizeProgramInput(req.body);
    const validationError = validateProgramData(programData);

    if (validationError) {
        return renderForm(res, {
            pageTitle: 'Modifier le programme',
            formAction: `/admin/programs/${id}`,
            submitLabel: 'Enregistrer les modifications',
            program: buildProgramForm(programData),
            error: validationError,
            session: req.session,
        });
    }

    try {
        await academicService.updateProgram(id, programData);
        setFlash(req, 'success', 'Programme mis à jour avec succès.');
        return res.redirect('/admin/programs');
    } catch (error) {
        console.error('Erreur mise à jour programme :', error);

        const message =
            error.code === 'P2002'
                ? 'Ce couple filière / niveau existe déjà.'
                : 'Une erreur est survenue lors de la mise à jour.';

        return renderForm(res, {
            pageTitle: 'Modifier le programme',
            formAction: `/admin/programs/${id}`,
            submitLabel: 'Enregistrer les modifications',
            program: buildProgramForm(programData),
            error: message,
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (!ensureCanWriteProgram(req, res, admin)) return;

    const { id } = req.params;

    try {
        const program = await academicService.getProgramDeletionState(id);

        if (!program) {
            setFlash(req, 'error', 'Programme introuvable.');
            return res.redirect('/admin/programs');
        }

        const hasDependencies =
            program._count.courses > 0 ||
            program._count.enrollments > 0 ||
            program._count.announcements > 0 ||
            program._count.classes > 0;

        if (hasDependencies) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : ce programme possède déjà des cours, inscriptions, annonces ou classes.'
            );
            return res.redirect('/admin/programs');
        }

        await academicService.deleteProgram(id);
        setFlash(req, 'success', 'Programme supprimé avec succès.');
        return res.redirect('/admin/programs');
    } catch (error) {
        console.error('Erreur suppression programme :', error);
        setFlash(req, 'error', 'Impossible de supprimer ce programme.');
        return res.redirect('/admin/programs');
    }
};