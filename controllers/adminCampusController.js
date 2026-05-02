const { setFlash } = require('../utils/flash');
const campusService = require('../services/campusService');

/*
 * Contrôleur d’administration pour la gestion des campus.
 * Implémente les actions index, createForm, store, editForm,
 * update et destroy. Ce contrôleur suit la même structure
 * que les autres contrôleurs d’administration existants.
 */

const renderForm = (res, options) => {
    return res.render('admin/campuses/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        campus: options.campus,
        error: options.error || null,
        session: options.session,
    });
};

exports.index = async (req, res) => {
    try {
        const campuses = await campusService.getCampuses();
        return res.render('admin/campuses/index', {
            campuses,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement campus admin :', error);
        setFlash(req, 'error', 'Impossible de charger les campus.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = (req, res) => {
    return renderForm(res, {
        pageTitle: 'Nouveau campus',
        formAction: '/admin/campuses',
        submitLabel: 'Créer le campus',
        campus: { code: '', nom: '', adresse: '' },
        session: req.session,
    });
};

exports.store = async (req, res) => {
    const { code, nom, adresse } = req.body;
    if (!code || !nom) {
        return renderForm(res, {
            pageTitle: 'Nouveau campus',
            formAction: '/admin/campuses',
            submitLabel: 'Créer le campus',
            campus: { code, nom, adresse },
            error: 'Veuillez remplir le code et le nom.',
            session: req.session,
        });
    }
    try {
        await campusService.createCampus({ code, nom, adresse });
        setFlash(req, 'success', 'Campus créé avec succès.');
        return res.redirect('/admin/campuses');
    } catch (error) {
        console.error('Erreur création campus :', error);
        let message = 'Une erreur est survenue lors de la création.';
        if (error.code === 'P2002') {
            message = 'Ce code de campus existe déjà.';
        }
        return renderForm(res, {
            pageTitle: 'Nouveau campus',
            formAction: '/admin/campuses',
            submitLabel: 'Créer le campus',
            campus: { code, nom, adresse },
            error: message,
            session: req.session,
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const campus = await campusService.getCampusById(req.params.id);
        if (!campus) {
            setFlash(req, 'error', 'Campus introuvable.');
            return res.redirect('/admin/campuses');
        }
        return renderForm(res, {
            pageTitle: 'Modifier le campus',
            formAction: `/admin/campuses/${campus.id}`,
            submitLabel: 'Enregistrer les modifications',
            campus,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition campus :', error);
        setFlash(req, 'error', 'Impossible de charger ce campus.');
        return res.redirect('/admin/campuses');
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const { code, nom, adresse } = req.body;
    if (!code || !nom) {
        return renderForm(res, {
            pageTitle: 'Modifier le campus',
            formAction: `/admin/campuses/${id}`,
            submitLabel: 'Enregistrer les modifications',
            campus: { id, code, nom, adresse },
            error: 'Veuillez remplir le code et le nom.',
            session: req.session,
        });
    }
    try {
        await campusService.updateCampus(id, { code, nom, adresse });
        setFlash(req, 'success', 'Campus mis à jour avec succès.');
        return res.redirect('/admin/campuses');
    } catch (error) {
        console.error('Erreur mise à jour campus :', error);
        let message = 'Une erreur est survenue lors de la mise à jour.';
        if (error.code === 'P2002') {
            message = 'Ce code de campus existe déjà.';
        }
        return renderForm(res, {
            pageTitle: 'Modifier le campus',
            formAction: `/admin/campuses/${id}`,
            submitLabel: 'Enregistrer les modifications',
            campus: { id, code, nom, adresse },
            error: message,
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;
    try {
        const campus = await campusService.getCampusDeletionState(id);
        if (!campus) {
            setFlash(req, 'error', 'Campus introuvable.');
            return res.redirect('/admin/campuses');
        }
        const hasDependencies =
            campus._count.departments > 0 ||
            campus._count.classes > 0 ||
            campus._count.professors > 0 ||
            campus._count.adminUsers > 0;
        if (hasDependencies) {
            setFlash(
                req,
                'error',
                'Suppression bloquée : ce campus possède déjà des départements, des classes, des professeurs ou des utilisateurs.'
            );
            return res.redirect('/admin/campuses');
        }
        await campusService.deleteCampus(id);
        setFlash(req, 'success', `Campus ${campus.nom} supprimé.`);
        return res.redirect('/admin/campuses');
    } catch (error) {
        console.error('Erreur suppression campus :', error);
        setFlash(req, 'error', 'Impossible de supprimer ce campus.');
        return res.redirect('/admin/campuses');
    }
};