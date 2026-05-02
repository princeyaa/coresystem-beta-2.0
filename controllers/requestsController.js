const { RequestType, RequestStatus } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { setFlash } = require('../utils/flash');
const {
    safeWriteAuditLog,
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const ALL_REQUEST_TYPES = Object.values(RequestType);
const ALL_REQUEST_STATUSES = Object.values(RequestStatus);

const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }

    return res.redirect('/login');
};

function normalizeText(value, maxLength = 120) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeType(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return ALL_REQUEST_TYPES.includes(value) ? value : 'all';
}

function normalizeStatus(value) {
    if (!value || value === 'all') {
        return 'all';
    }

    return ALL_REQUEST_STATUSES.includes(value) ? value : 'all';
}

function matchesSearch(request, query) {
    if (!query) {
        return true;
    }

    const lowerQuery = query.toLowerCase();

    const searchableValues = [
        request.typeDemande,
        request.statut,
        request.motif,
        request.commentaire,
        request.treatedBy ? request.treatedBy.nom : '',
        request.treatedBy ? request.treatedBy.prenom : '',
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    return searchableValues.some((value) => value.includes(lowerQuery));
}

function buildStats(allRequests, filteredRequests) {
    return {
        total: allRequests.length,
        filtered: filteredRequests.length,
        submitted: allRequests.filter((request) => request.statut === 'SOUMISE').length,
        processing: allRequests.filter((request) => request.statut === 'EN_TRAITEMENT').length,
        treated: allRequests.filter((request) => request.statut === 'TRAITEE').length,
        rejected: allRequests.filter((request) => request.statut === 'REJETEE').length,
    };
}

async function getStudentContext(studentId) {
    return prisma.student.findUnique({
        where: {
            id: studentId,
        },
        include: {
            enrollments: {
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    program: true,
                    class: {
                        include: {
                            campus: true,
                            department: true,
                        },
                    },
                },
            },
        },
    });
}

const getRequests = async (req, res) => {
    try {
        const selectedType = normalizeType(req.query.type);
        const selectedStatus = normalizeStatus(req.query.status);
        const searchQuery = normalizeText(req.query.q);

        const [student, allRequests] = await Promise.all([
            getStudentContext(req.session.userId),

            prisma.request.findMany({
                where: {
                    studentId: req.session.userId,
                },
                include: {
                    treatedBy: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            }),
        ]);

        if (!student) {
            return res.redirect('/login');
        }

        const filteredRequests = allRequests.filter((request) => {
            const typeMatches =
                selectedType === 'all' || request.typeDemande === selectedType;

            const statusMatches =
                selectedStatus === 'all' || request.statut === selectedStatus;

            return typeMatches && statusMatches && matchesSearch(request, searchQuery);
        });

        const latestRequestAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.REQUEST,
            filteredRequests.map((request) => request.id)
        );

        const requestsWithTrace = filteredRequests.map((request) => ({
            ...request,
            traceMeta: toTraceMeta(latestRequestAudits[request.id], {
                label: 'Demande soumise',
                summary: 'Demande enregistrée',
                actorName: `${student.prenom} ${student.nom}`,
                actorRole: 'STUDENT',
                createdAt: request.createdAt,
            }),
        }));

        const latestEnrollment =
            student.enrollments && student.enrollments.length
                ? student.enrollments[0]
                : null;

        return res.render('requests/index', {
            pageTitle: 'Mes demandes administratives',
            student,
            latestEnrollment,
            requests: requestsWithTrace,
            requestTypes: ALL_REQUEST_TYPES,
            requestStatuses: ALL_REQUEST_STATUSES,
            filters: {
                q: searchQuery,
                type: selectedType,
                status: selectedStatus,
            },
            stats: buildStats(allRequests, filteredRequests),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur lors du chargement des demandes :', error);
        return res.status(500).send('Erreur interne du serveur');
    }
};

const postRequest = async (req, res) => {
    const typeDemande = normalizeText(req.body.typeDemande, 80).toUpperCase();
    const motif = normalizeText(req.body.motif, 800) || null;

    if (!ALL_REQUEST_TYPES.includes(typeDemande)) {
        setFlash(req, 'error', 'Type de demande invalide.');
        return res.redirect('/requests');
    }

    try {
        const createdRequest = await prisma.request.create({
            data: {
                typeDemande,
                motif,
                studentId: req.session.userId,
            },
        });

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.REQUEST,
            entityId: createdRequest.id,
            action: AUDIT_ACTIONS.CREATE,
            summary: `Soumission d’une demande ${typeDemande}`,
            beforeData: null,
            afterData: {
                id: createdRequest.id,
                typeDemande: createdRequest.typeDemande,
                motif: createdRequest.motif,
                statut: createdRequest.statut,
                studentId: createdRequest.studentId,
                createdAt: createdRequest.createdAt,
            },
        });

        setFlash(req, 'success', 'Votre demande a été soumise avec succès.');
        return res.redirect('/requests');
    } catch (error) {
        console.error('Erreur lors de la création de la demande :', error);
        setFlash(req, 'error', 'Impossible de soumettre cette demande.');
        return res.redirect('/requests');
    }
};

module.exports = {
    ensureAuthenticated,
    getRequests,
    postRequest,
};