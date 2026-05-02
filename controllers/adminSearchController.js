const { setFlash } = require('../utils/flash');
const searchService = require('../services/searchService');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
} = require('../middlewares/permissions');

const SCOPE_LABELS = {
    all: 'Toutes les catégories',
    students: 'Étudiants',
    professors: 'Professeurs',
    classes: 'Classes',
    requests: 'Demandes',
    assignments: 'Affectations',
};

function isLocalAdminMisconfigured(admin) {
    return admin && !isGlobalAdmin(admin) && !admin.campusId;
}

exports.index = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(
                req,
                'error',
                'Votre compte administrateur n’est rattaché à aucun campus.'
            );
            return res.redirect('/admin/dashboard');
        }

        const search = await searchService.searchGlobal({
            admin,
            q: req.query.q,
            scope: req.query.scope,
        });

        return res.render('admin/search/index', {
            pageTitle: 'Recherche globale',
            searchQuery: search.query,
            hasQuery: search.hasQuery,
            resultLimit: search.limit,
            counts: search.counts,
            results: search.results,
            activeScope: search.activeScope,
            scopeOptions: searchService.SEARCH_SCOPES.map((value) => ({
                value,
                label: SCOPE_LABELS[value] || value,
            })),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur recherche globale admin :', error);
        setFlash(req, 'error', 'Impossible d’exécuter la recherche globale.');
        return res.redirect('/admin/dashboard');
    }
};