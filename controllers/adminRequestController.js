const { setFlash } = require('../utils/flash');
const {
    ALL_REQUEST_TYPES,
    ALL_REQUEST_STATUSES,
    ALLOWED_TARGET_REQUEST_STATUSES,
    sanitizeRequestStatusUpdate,
    validateRequestStatusUpdate,
} = require('../utils/validators/adminManagement');

const adminRequestService = require('../services/adminRequestService');
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

function buildRequestScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
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
}

function getRequestCampusId(request) {
    if (
        !request ||
        !request.student ||
        !request.student.enrollments ||
        !request.student.enrollments.length
    ) {
        return null;
    }

    const enrollment = request.student.enrollments[0];

    if (!enrollment.class || !enrollment.class.campus) {
        return null;
    }

    return enrollment.class.campus.id;
}

function buildRequestAuditSnapshot(request) {
    if (!request) return null;

    return {
        id: request.id,
        typeDemande: request.typeDemande,
        statut: request.statut,
        commentaire: request.commentaire,
        treatedAt: request.treatedAt,
        treatedById: request.treatedById,
        studentId: request.studentId || (request.student ? request.student.id : null),
        studentNom: request.student ? `${request.student.prenom} ${request.student.nom}` : null,
    };
}

exports.index = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const statusFilter =
            req.query.status && ALL_REQUEST_STATUSES.includes(req.query.status)
                ? req.query.status
                : 'all';

        const typeFilter =
            req.query.type && ALL_REQUEST_TYPES.includes(req.query.type)
                ? req.query.type
                : 'all';

        const searchQuery =
            typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

        const scopedWhere = buildRequestScopeWhere(admin);

        const [requests, statusCountRows] = await Promise.all([
            adminRequestService.getRequestsWithFilters({
                status: statusFilter,
                type: typeFilter,
                q: searchQuery,
                scopedWhere,
            }),
            adminRequestService.getRequestStatusCounts({
                type: typeFilter,
                q: searchQuery,
                scopedWhere,
            }),
        ]);

        const statusCounts = ALL_REQUEST_STATUSES.reduce(
            (accumulator, status) => {
                accumulator[status] = 0;
                return accumulator;
            },
            { all: 0 }
        );

        statusCountRows.forEach((row) => {
            statusCounts[row.statut] = row._count._all;
            statusCounts.all += row._count._all;
        });

        return res.render('admin/requests/index', {
            requests,
            filters: {
                status: statusFilter,
                type: typeFilter,
                q: searchQuery,
            },
            requestStatuses: ALL_REQUEST_STATUSES,
            requestTypes: ALL_REQUEST_TYPES,
            statusCounts,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement demandes admin :', error);
        setFlash(req, 'error', 'Impossible de charger les demandes.');
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

        const request = await adminRequestService.getRequestWithRelations(
            req.params.id,
            buildRequestScopeWhere(admin)
        );

        if (!request) {
            setFlash(req, 'error', 'Demande introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/requests');
        }

        const latestRequestAuditMap = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.REQUEST,
            [request.id]
        );

        const requestTraceMeta = toTraceMeta(
            latestRequestAuditMap[request.id],
            null
        );

        const requestTraceHistory = await getAuditHistory(
            AUDIT_ENTITY_TYPES.REQUEST,
            request.id,
            { limit: 6 }
        );

        return res.render('admin/requests/show', {
            request,
            allowedTargetStatuses: ALLOWED_TARGET_REQUEST_STATUSES,
            session: req.session,
            error: null,
            requestTraceMeta,
            requestTraceHistory,
        });
    } catch (error) {
        console.error('Erreur chargement détail demande admin :', error);
        setFlash(req, 'error', 'Impossible de charger cette demande.');
        return res.redirect('/admin/requests');
    }
};

exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const updateData = sanitizeRequestStatusUpdate(req.body);
    const validationError = validateRequestStatusUpdate(updateData);
    const admin = await resolveCurrentAdmin(req);

    if (validationError) {
        const request = await adminRequestService.getRequestWithRelations(
            id,
            buildRequestScopeWhere(admin)
        );

        if (!request) {
            setFlash(req, 'error', 'Demande introuvable.');
            return res.redirect('/admin/requests');
        }

        const latestRequestAuditMap = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.REQUEST,
            [request.id]
        );

        const requestTraceMeta = toTraceMeta(
            latestRequestAuditMap[request.id],
            null
        );

        const requestTraceHistory = await getAuditHistory(
            AUDIT_ENTITY_TYPES.REQUEST,
            request.id,
            { limit: 6 }
        );

        return res.status(400).render('admin/requests/show', {
            request,
            allowedTargetStatuses: ALLOWED_TARGET_REQUEST_STATUSES,
            session: req.session,
            error: validationError,
            requestTraceMeta,
            requestTraceHistory,
        });
    }

    try {
        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const existingRequest = await adminRequestService.getRequestWithRelations(
            id,
            buildRequestScopeWhere(admin)
        );

        if (!existingRequest) {
            setFlash(req, 'error', 'Demande introuvable ou hors de votre périmètre.');
            return res.redirect('/admin/requests');
        }

        const now = new Date();

        const payload = {
            statut: updateData.statut,
            commentaire: updateData.commentaire || null,
            treatedAt: now,
            treatedById: req.session.adminId,
        };

        await adminRequestService.updateRequestStatus(id, payload);

        const updatedRequest = await adminRequestService.getRequestWithRelations(
            id,
            buildRequestScopeWhere(admin)
        );

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.REQUEST,
            entityId: id,
            action: AUDIT_ACTIONS.STATUS_CHANGE,
            campusId: getRequestCampusId(updatedRequest || existingRequest),
            summary: `Changement de statut de demande ${existingRequest.typeDemande} vers ${updateData.statut}`,
            beforeData: buildRequestAuditSnapshot(existingRequest),
            afterData: buildRequestAuditSnapshot(updatedRequest) || {
                ...buildRequestAuditSnapshot(existingRequest),
                statut: updateData.statut,
                commentaire: updateData.commentaire || null,
                treatedById: req.session.adminId,
                treatedAt: now.toISOString(),
            },
        });

        setFlash(req, 'success', 'Statut de la demande mis à jour avec succès.');
        return res.redirect(`/admin/requests/${id}`);
    } catch (error) {
        console.error('Erreur mise à jour demande admin :', error);
        setFlash(req, 'error', 'Impossible de mettre à jour cette demande.');
        return res.redirect('/admin/requests');
    }
};