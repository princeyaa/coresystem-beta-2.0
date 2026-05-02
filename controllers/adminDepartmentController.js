const { setFlash } = require('../utils/flash');
const departmentService = require('../services/departmentService');
const campusService = require('../services/campusService');

/*
 * Contrôleur d’administration pour la gestion des départements.
 */

const renderForm = async (res, options) => {
    const campuses = await campusService.getCampuses();

    return res.render('admin/departments/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        department: options.department,
        campuses,
        error: options.error || null,
        session: options.session,
    });
};

exports.index = async (req, res) => {
    try {
        const departments = await departmentService.getDepartments();

        return res.render('admin/departments/index', {
            departments,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement départements admin :', error);
        setFlash(req, 'error', 'Impossible de charger les départements.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = async (req, res) => {
    return renderForm(res, {
        pageTitle: 'Nouveau département',
        formAction: '/admin/departments',
        submitLabel: 'Créer le département',
        department: { code: '', nom: '', campusId: '' },
        session: req.session,
    });
};

exports.store = async (req, res) => {
    const { code, nom, campusId } = req.body;

    if (!code || !nom || !campusId) {
        return renderForm(res, {
            pageTitle: 'Nouveau département',
            formAction: '/admin/departments',
            submitLabel: 'Créer le département',
            department: { code, nom, campusId },
            error: 'Veuillez remplir tous les champs obligatoires.',
            session: req.session,
        });
    }

    try {
        await departmentService.createDepartment({ code, nom, campusId });
        setFlash(req, 'success', 'Département créé avec succès.');
        return res.redirect('/admin/departments');
    } catch (error) {
        console.error('Erreur création département :', error);

        let message = 'Une erreur est survenue lors de la création.';
        if (error.code === 'P2002') {
            message = 'Ce code de département existe déjà.';
        }

        return renderForm(res, {
            pageTitle: 'Nouveau département',
            formAction: '/admin/departments',
            submitLabel: 'Créer le département',
            department: { code, nom, campusId },
            error: message,
            session: req.session,
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const department = await departmentService.getDepartmentById(req.params.id);

        if (!department) {
            setFlash(req, 'error', 'Département introuvable.');
            return res.redirect('/admin/departments');
        }

        return renderForm(res, {
            pageTitle: 'Modifier le département',
            formAction: `/admin/departments/${department.id}`,
            submitLabel: 'Enregistrer les modifications',
            department,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition département :', error);
        setFlash(req, 'error', 'Impossible de charger ce département.');
        return res.redirect('/admin/departments');
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const { code, nom, campusId } = req.body;

    if (!code || !nom || !campusId) {
        return renderForm(res, {
            pageTitle: 'Modifier le département',
            formAction: `/admin/departments/${id}`,
            submitLabel: 'Enregistrer les modifications',
            department: { id, code, nom, campusId },
            error: 'Veuillez remplir tous les champs obligatoires.',
            session: req.session,
        });
    }

    try {
        await departmentService.updateDepartment(id, { code, nom, campusId });
        setFlash(req, 'success', 'Département mis à jour avec succès.');
        return res.redirect('/admin/departments');
    } catch (error) {
        console.error('Erreur mise à jour département :', error);

        let message = 'Une erreur est survenue lors de la mise à jour.';
        if (error.code === 'P2002') {
            message = 'Ce code de département existe déjà.';
        }

        return renderForm(res, {
            pageTitle: 'Modifier le département',
            formAction: `/admin/departments/${id}`,
            submitLabel: 'Enregistrer les modifications',
            department: { id, code, nom, campusId },
            error: message,
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;

    try {
        const department = await departmentService.getDepartmentDeletionState(id);

        if (!department) {
            setFlash(req, 'error', 'Département introuvable.');
            return res.redirect('/admin/departments');
        }

        const hasDependencies =
            department._count.classes > 0 ||
            department._count.professors > 0 ||
            department._count.adminUsers > 0;

        if (hasDependencies) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : ce département possède déjà des classes, des professeurs ou des utilisateurs.'
            );
            return res.redirect('/admin/departments');
        }

        await departmentService.deleteDepartment(id);
        setFlash(req, 'success', `Département ${department.nom} supprimé.`);
        return res.redirect('/admin/departments');
    } catch (error) {
        console.error('Erreur suppression département :', error);
        setFlash(req, 'error', 'Impossible de supprimer ce département.');
        return res.redirect('/admin/departments');
    }
};