const prisma = require('../lib/prisma');

/*
 * Service dédié aux demandes administratives côté admin.
 *
 * Le scope campus/département est appliqué via :
 * Request -> Student -> Enrollment -> AcademicClass
 *
 * Cela permet à un admin local de voir uniquement les demandes
 * des étudiants inscrits dans une classe de son périmètre.
 */

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const sanitizeSearchQuery = (value) => normalizeText(value).slice(0, 100);

const buildSearchWhere = (rawQuery) => {
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
                    { motif: { contains: term } },
                    { commentaire: { contains: term } },
                    {
                        student: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                    {
                        student: {
                            is: {
                                prenom: { contains: term },
                            },
                        },
                    },
                    {
                        student: {
                            is: {
                                matricule: { contains: term },
                            },
                        },
                    },
                ],
            })),
        },
    };
};

const buildBaseRequestWhere = ({
    status = 'all',
    type = 'all',
    q = '',
    scopedWhere = {},
    includeStatus = true,
} = {}) => {
    const { searchWhere } = buildSearchWhere(q);

    const where = {
        AND: [scopedWhere, searchWhere].filter(
            (clause) => clause && Object.keys(clause).length > 0
        ),
    };

    if (!where.AND.length) {
        delete where.AND;
    }

    if (includeStatus && status !== 'all') {
        where.statut = status;
    }

    if (type !== 'all') {
        where.typeDemande = type;
    }

    return where;
};

const getRequestsWithFilters = async ({ status, type, q = '', scopedWhere = {} }) => {
    const where = buildBaseRequestWhere({ status, type, q, scopedWhere });

    return prisma.request.findMany({
        where,
        include: {
            student: {
                include: {
                    enrollments: {
                        orderBy: { createdAt: 'desc' },
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
            },
            treatedBy: true,
        },
        orderBy: [{ createdAt: 'desc' }],
    });
};

const getRequestStatusCounts = async ({ type = 'all', q = '', scopedWhere = {} }) => {
    const where = buildBaseRequestWhere({
        type,
        q,
        scopedWhere,
        includeStatus: false,
    });

    return prisma.request.groupBy({
        by: ['statut'],
        where,
        _count: {
            _all: true,
        },
    });
};

const getRequestWithRelations = async (id, scopedWhere = {}) => {
    return prisma.request.findFirst({
        where: {
            id,
            ...scopedWhere,
        },
        include: {
            student: {
                include: {
                    enrollments: {
                        orderBy: { createdAt: 'desc' },
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
            },
            treatedBy: true,
        },
    });
};

const requestExists = async (id, scopedWhere = {}) => {
    return prisma.request.findFirst({
        where: {
            id,
            ...scopedWhere,
        },
        select: {
            id: true,
        },
    });
};

const updateRequestStatus = async (id, data) => {
    return prisma.request.update({
        where: { id },
        data,
    });
};

module.exports = {
    getRequestsWithFilters,
    getRequestStatusCounts,
    getRequestWithRelations,
    requestExists,
    updateRequestStatus,
};