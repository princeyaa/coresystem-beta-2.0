const prisma = require('../lib/prisma');
const {
    isGlobalAdmin,
    buildAdminScopedWhere,
} = require('../middlewares/permissions');

const DEFAULT_LIMIT = 6;
const SEARCH_SCOPES = [
    'all',
    'students',
    'professors',
    'classes',
    'requests',
    'assignments',
];

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSearchQuery(value) {
    return normalizeText(value).slice(0, 100);
}

function buildTerms(query) {
    return sanitizeSearchQuery(query)
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 5);
}

function normalizeSearchScope(scope) {
    const normalized = normalizeText(scope).toLowerCase();
    return SEARCH_SCOPES.includes(normalized) ? normalized : 'all';
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

function buildTermsWhere(terms, buildOrClausesForTerm) {
    if (!terms || !terms.length) {
        return {};
    }

    return {
        AND: terms.map((term) => ({
            OR: buildOrClausesForTerm(term),
        })),
    };
}

function buildStudentScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        enrollments: {
            some: {
                class: {
                    is: {
                        campusId: admin.campusId,
                    },
                },
            },
        },
    };
}

function buildProfessorScopeWhere(admin) {
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
                        campusId: admin.campusId,
                    },
                },
            },
        },
    };
}

function buildAssignmentScopeWhere(admin) {
    if (!admin || isGlobalAdmin(admin)) {
        return {};
    }

    return {
        class: {
            campusId: admin.campusId,
        },
    };
}

async function searchStudents(admin, terms, limit = DEFAULT_LIMIT) {
    const where = mergeWhereClauses(
        buildStudentScopeWhere(admin),
        buildTermsWhere(terms, (term) => [
            { matricule: { contains: term } },
            { nom: { contains: term } },
            { prenom: { contains: term } },
            { email: { contains: term } },
            {
                enrollments: {
                    some: {
                        class: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                },
            },
            {
                enrollments: {
                    some: {
                        class: {
                            is: {
                                code: { contains: term },
                            },
                        },
                    },
                },
            },
            {
                enrollments: {
                    some: {
                        program: {
                            is: {
                                filiere: { contains: term },
                            },
                        },
                    },
                },
            },
            {
                enrollments: {
                    some: {
                        program: {
                            is: {
                                niveau: { contains: term },
                            },
                        },
                    },
                },
            },
        ])
    );

    return prisma.student.findMany({
        where,
        take: limit,
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        include: {
            enrollments: {
                orderBy: [{ createdAt: 'desc' }],
                take: 1,
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

async function searchProfessors(admin, terms, limit = DEFAULT_LIMIT) {
    const where = mergeWhereClauses(
        buildProfessorScopeWhere(admin),
        buildTermsWhere(terms, (term) => [
            { nom: { contains: term } },
            { prenom: { contains: term } },
            { email: { contains: term } },
            { telephone: { contains: term } },
            {
                campus: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
            {
                department: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
        ])
    );

    return prisma.professor.findMany({
        where,
        take: limit,
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        include: {
            campus: true,
            department: true,
            _count: {
                select: {
                    assignments: true,
                },
            },
        },
    });
}

async function searchClasses(admin, terms, limit = DEFAULT_LIMIT) {
    const where = mergeWhereClauses(
        buildAdminScopedWhere(admin),
        buildTermsWhere(terms, (term) => [
            { nom: { contains: term } },
            { code: { contains: term } },
            { academicYear: { contains: term } },
            {
                program: {
                    is: {
                        filiere: { contains: term },
                    },
                },
            },
            {
                program: {
                    is: {
                        niveau: { contains: term },
                    },
                },
            },
            {
                campus: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
            {
                department: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
        ])
    );

    return prisma.academicClass.findMany({
        where,
        take: limit,
        orderBy: [{ academicYear: 'desc' }, { nom: 'asc' }],
        include: {
            campus: true,
            department: true,
            program: true,
            _count: {
                select: {
                    enrollments: true,
                    teachingAssignments: true,
                },
            },
        },
    });
}

async function searchRequests(admin, terms, limit = DEFAULT_LIMIT) {
    const where = mergeWhereClauses(
        buildRequestScopeWhere(admin),
        buildTermsWhere(terms, (term) => [
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
        ])
    );

    return prisma.request.findMany({
        where,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
            student: true,
            treatedBy: true,
        },
    });
}

async function searchAssignments(admin, terms, limit = DEFAULT_LIMIT) {
    const where = mergeWhereClauses(
        buildAssignmentScopeWhere(admin),
        buildTermsWhere(terms, (term) => [
            {
                professor: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
            {
                professor: {
                    is: {
                        prenom: { contains: term },
                    },
                },
            },
            {
                professor: {
                    is: {
                        email: { contains: term },
                    },
                },
            },
            {
                course: {
                    is: {
                        code: { contains: term },
                    },
                },
            },
            {
                course: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
            {
                class: {
                    is: {
                        nom: { contains: term },
                    },
                },
            },
            {
                class: {
                    is: {
                        code: { contains: term },
                    },
                },
            },
            {
                class: {
                    is: {
                        academicYear: { contains: term },
                    },
                },
            },
            {
                class: {
                    is: {
                        campus: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                },
            },
            {
                class: {
                    is: {
                        department: {
                            is: {
                                nom: { contains: term },
                            },
                        },
                    },
                },
            },
        ])
    );

    return prisma.teachingAssignment.findMany({
        where,
        take: limit,
        orderBy: [{ academicYear: 'desc' }, { createdAt: 'desc' }],
        include: {
            professor: true,
            course: {
                include: {
                    program: true,
                },
            },
            class: {
                include: {
                    campus: true,
                    department: true,
                    program: true,
                },
            },
        },
    });
}

async function searchGlobal({ admin, q, scope = 'all', limit = DEFAULT_LIMIT }) {
    const query = sanitizeSearchQuery(q);
    const terms = buildTerms(query);
    const activeScope = normalizeSearchScope(scope);

    const emptyResults = {
        students: [],
        professors: [],
        classes: [],
        requests: [],
        assignments: [],
    };

    const emptyCounts = {
        students: 0,
        professors: 0,
        classes: 0,
        requests: 0,
        assignments: 0,
        total: 0,
    };

    if (!terms.length) {
        return {
            query: '',
            hasQuery: false,
            activeScope,
            limit,
            results: emptyResults,
            counts: emptyCounts,
        };
    }

    const runners = {
        students: () => searchStudents(admin, terms, limit),
        professors: () => searchProfessors(admin, terms, limit),
        classes: () => searchClasses(admin, terms, limit),
        requests: () => searchRequests(admin, terms, limit),
        assignments: () => searchAssignments(admin, terms, limit),
    };

    const scopesToRun =
        activeScope === 'all'
            ? ['students', 'professors', 'classes', 'requests', 'assignments']
            : [activeScope];

    const results = { ...emptyResults };

    await Promise.all(
        scopesToRun.map(async (scopeKey) => {
            results[scopeKey] = await runners[scopeKey]();
        })
    );

    const counts = {
        students: results.students.length,
        professors: results.professors.length,
        classes: results.classes.length,
        requests: results.requests.length,
        assignments: results.assignments.length,
        total:
            results.students.length +
            results.professors.length +
            results.classes.length +
            results.requests.length +
            results.assignments.length,
    };

    return {
        query,
        hasQuery: true,
        activeScope,
        limit,
        results,
        counts,
    };
}

module.exports = {
    SEARCH_SCOPES,
    searchStudents,
    searchProfessors,
    searchClasses,
    searchRequests,
    searchAssignments,
    searchGlobal,
};