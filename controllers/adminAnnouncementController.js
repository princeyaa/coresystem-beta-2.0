const { setFlash } = require('../utils/flash');
const {
    ALLOWED_PRIORITIES,
    ALLOWED_SCOPES,
    sanitizeAnnouncementInput,
    buildAnnouncementForm,
    parseExpiresAt,
    validateAnnouncementData,
} = require('../utils/validators/adminManagement');
const adminService = require('../services/adminService');
const {
    safeWriteAuditLog,
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

function buildAnnouncementAuditSnapshot(announcement, author = null, program = null) {
    if (!announcement) return null;

    return {
        id: announcement.id,
        titre: announcement.titre,
        priorite: announcement.priorite,
        programId: announcement.programId || null,
        programLabel: program
            ? `${program.filiere} ${program.niveau}`
            : null,
        expiresAt: announcement.expiresAt || null,
        authorId: announcement.authorId || null,
        authorName: author
            ? `${author.prenom} ${author.nom}`
            : null,
    };
}

const renderForm = async (res, options) => {
    const programs = await adminService.getProgramsBasic();

    return res.render('admin/announcements/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        announcement: options.announcement,
        programs,
        allowedPriorities: ALLOWED_PRIORITIES,
        error: options.error || null,
        session: options.session,
    });
};

exports.index = async (req, res) => {
    try {
        const scope = ALLOWED_SCOPES.includes(req.query.scope)
            ? req.query.scope
            : 'all';

        const priority =
            req.query.priority && ALLOWED_PRIORITIES.includes(req.query.priority)
                ? req.query.priority
                : 'all';

        const announcements = await adminService.getAnnouncementsWithFilters({
            scope,
            priority,
        });

        const latestAnnouncementAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.ANNOUNCEMENT,
            announcements.map((announcement) => announcement.id)
        );

        const announcementTraceMap = {};
        announcements.forEach((announcement) => {
            announcementTraceMap[announcement.id] = toTraceMeta(
                latestAnnouncementAudits[announcement.id],
                {
                    label: 'Publié par',
                    summary: 'Annonce publiée',
                    actorName: announcement.author
                        ? `${announcement.author.prenom} ${announcement.author.nom}`
                        : 'Administration',
                    actorRole: announcement.author ? announcement.author.role : 'ADMIN',
                    createdAt: announcement.createdAt,
                }
            );
        });

        return res.render('admin/announcements/index', {
            announcements,
            announcementTraceMap,
            filters: { scope, priority },
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement annonces admin :', error);
        setFlash(req, 'error', 'Impossible de charger les annonces.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = async (req, res) => {
    try {
        return await renderForm(res, {
            pageTitle: 'Nouvelle annonce',
            formAction: '/admin/announcements',
            submitLabel: 'Créer l’annonce',
            announcement: buildAnnouncementForm(),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire création annonce :', error);
        setFlash(req, 'error', 'Impossible de charger le formulaire de création.');
        return res.redirect('/admin/announcements');
    }
};

exports.store = async (req, res) => {
    const announcementData = sanitizeAnnouncementInput(req.body);
    const { value: expiresAt, error: expiresAtError } = parseExpiresAt(
        announcementData.expiresAtRaw
    );

    const validationError = validateAnnouncementData(
        announcementData,
        expiresAtError
    );

    if (validationError) {
        return await renderForm(res, {
            pageTitle: 'Nouvelle annonce',
            formAction: '/admin/announcements',
            submitLabel: 'Créer l’annonce',
            announcement: buildAnnouncementForm(announcementData),
            error: validationError,
            session: req.session,
        });
    }

    try {
        let programExists = null;

        if (announcementData.programId) {
            programExists = await adminService.getProgramById(announcementData.programId);

            if (!programExists) {
                return await renderForm(res, {
                    pageTitle: 'Nouvelle annonce',
                    formAction: '/admin/announcements',
                    submitLabel: 'Créer l’annonce',
                    announcement: buildAnnouncementForm(announcementData),
                    error: 'Le programme sélectionné est introuvable.',
                    session: req.session,
                });
            }
        }

        const createdAnnouncement = await adminService.createAnnouncement({
            titre: announcementData.titre,
            contenu: announcementData.contenu,
            priorite: announcementData.priorite,
            programId: announcementData.programId,
            expiresAt,
            authorId: req.session.adminId,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ANNOUNCEMENT,
            entityId: createdAnnouncement.id,
            action: AUDIT_ACTIONS.CREATE,
            summary: `Création de l’annonce ${createdAnnouncement.titre}`,
            beforeData: null,
            afterData: buildAnnouncementAuditSnapshot(
                createdAnnouncement,
                null,
                programExists
            ),
        });

        setFlash(req, 'success', 'Annonce créée avec succès.');
        return res.redirect('/admin/announcements');
    } catch (error) {
        console.error('Erreur création annonce :', error);
        return await renderForm(res, {
            pageTitle: 'Nouvelle annonce',
            formAction: '/admin/announcements',
            submitLabel: 'Créer l’annonce',
            announcement: buildAnnouncementForm(announcementData),
            error: 'Une erreur est survenue lors de la création.',
            session: req.session,
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const announcement = await adminService.getAnnouncementById(req.params.id);

        if (!announcement) {
            setFlash(req, 'error', 'Annonce introuvable.');
            return res.redirect('/admin/announcements');
        }

        return await renderForm(res, {
            pageTitle: 'Modifier l’annonce',
            formAction: `/admin/announcements/${announcement.id}`,
            submitLabel: 'Enregistrer les modifications',
            announcement: buildAnnouncementForm(announcement),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition annonce :', error);
        setFlash(req, 'error', 'Impossible de charger cette annonce.');
        return res.redirect('/admin/announcements');
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const announcementData = sanitizeAnnouncementInput(req.body);
    const { value: expiresAt, error: expiresAtError } = parseExpiresAt(
        announcementData.expiresAtRaw
    );

    const validationError = validateAnnouncementData(
        announcementData,
        expiresAtError
    );

    if (validationError) {
        return await renderForm(res, {
            pageTitle: 'Modifier l’annonce',
            formAction: `/admin/announcements/${id}`,
            submitLabel: 'Enregistrer les modifications',
            announcement: buildAnnouncementForm({ id, ...announcementData }),
            error: validationError,
            session: req.session,
        });
    }

    try {
        const existingAnnouncement = await adminService.getAnnouncementById(id);

        if (!existingAnnouncement) {
            setFlash(req, 'error', 'Annonce introuvable.');
            return res.redirect('/admin/announcements');
        }

        let programExists = null;

        if (announcementData.programId) {
            programExists = await adminService.getProgramById(announcementData.programId);

            if (!programExists) {
                return await renderForm(res, {
                    pageTitle: 'Modifier l’annonce',
                    formAction: `/admin/announcements/${id}`,
                    submitLabel: 'Enregistrer les modifications',
                    announcement: buildAnnouncementForm({ id, ...announcementData }),
                    error: 'Le programme sélectionné est introuvable.',
                    session: req.session,
                });
            }
        }

        const updatedAnnouncement = await adminService.updateAnnouncement(id, {
            titre: announcementData.titre,
            contenu: announcementData.contenu,
            priorite: announcementData.priorite,
            programId: announcementData.programId,
            expiresAt,
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ANNOUNCEMENT,
            entityId: id,
            action: AUDIT_ACTIONS.UPDATE,
            summary: `Modification de l’annonce ${updatedAnnouncement.titre}`,
            beforeData: buildAnnouncementAuditSnapshot(existingAnnouncement),
            afterData: buildAnnouncementAuditSnapshot(
                updatedAnnouncement,
                null,
                programExists
            ),
        });

        setFlash(req, 'success', 'Annonce mise à jour avec succès.');
        return res.redirect('/admin/announcements');
    } catch (error) {
        console.error('Erreur mise à jour annonce :', error);

        return await renderForm(res, {
            pageTitle: 'Modifier l’annonce',
            formAction: `/admin/announcements/${id}`,
            submitLabel: 'Enregistrer les modifications',
            announcement: buildAnnouncementForm({ id, ...announcementData }),
            error: 'Une erreur est survenue lors de la mise à jour.',
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;

    try {
        const announcement = await adminService.getAnnouncementDeleteTarget(id);

        if (!announcement) {
            setFlash(req, 'error', 'Annonce introuvable.');
            return res.redirect('/admin/announcements');
        }

        await adminService.deleteAnnouncement(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.ANNOUNCEMENT,
            entityId: id,
            action: AUDIT_ACTIONS.DELETE,
            summary: `Suppression de l’annonce ${announcement.titre}`,
            beforeData: {
                id: announcement.id,
                titre: announcement.titre,
            },
            afterData: null,
        });

        setFlash(req, 'success', `Annonce "${announcement.titre}" supprimée.`);
        return res.redirect('/admin/announcements');
    } catch (error) {
        console.error('Erreur suppression annonce :', error);
        setFlash(req, 'error', 'Impossible de supprimer cette annonce.');
        return res.redirect('/admin/announcements');
    }
};