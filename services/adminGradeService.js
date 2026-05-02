const prisma = require('../lib/prisma');

/*
 * Service dédié aux notes côté administration.
 *
 * Le scope campus/département passe par :
 * Grade -> Student -> Enrollment -> AcademicClass
 *
 * Les cours restent globaux, mais pour un admin local, on limite les cours
 * aux programmes ayant au moins une classe dans son périmètre.
 */

const getStudentsForGradeForm = async (where = {}) => {
    return prisma.student.findMany({
        where,
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
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
    });
};

const getCoursesForGradeForm = async (where = {}) => {
    return prisma.course.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        include: {
            program: true,
        },
    });
};

const getGradesWithRelations = async (where = {}) => {
    return prisma.grade.findMany({
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
            course: {
                include: {
                    program: true,
                },
            },
        },
        orderBy: [{ createdAt: 'desc' }],
    });
};

const getGradeById = async (id, where = {}) => {
    return prisma.grade.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            student: {
                include: {
                    enrollments: {
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
            course: {
                include: {
                    program: true,
                },
            },
        },
    });
};

const getGradeWithPublishContext = async (id, where = {}) => {
    return prisma.grade.findFirst({
        where: {
            id,
            ...where,
        },
        select: {
            id: true,
            published: true,
            studentId: true,
            courseId: true,
            student: {
                select: {
                    prenom: true,
                    nom: true,
                    enrollments: {
                        select: {
                            class: {
                                select: {
                                    campusId: true,
                                    departmentId: true,
                                },
                            },
                        },
                    },
                },
            },
            course: {
                select: {
                    code: true,
                    nom: true,
                    programId: true,
                },
            },
        },
    });
};

const getGradeWithRelations = async (id, where = {}) => {
    return prisma.grade.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            student: true,
            course: true,
        },
    });
};

const createGrade = async (data) => {
    return prisma.grade.create({ data });
};
const PUBLISHED_GRADE_LOCK_ERROR = 'PUBLISHED_GRADE_LOCK_ERROR';
const updateGrade = async (id, data) => {
    const existingGrade = await prisma.grade.findUnique({
        where: { id },
        select: {
            id: true,
            published: true,
        },
    });

    if (!existingGrade) {
        const error = new Error('Note introuvable.');
        error.code = 'GRADE_NOT_FOUND';
        throw error;
    }

    if (existingGrade.published) {
        const error = new Error(
            'Note déjà publiée, impossible de modifier. Veuillez d’abord la dépublier.'
        );
        error.code = PUBLISHED_GRADE_LOCK_ERROR;
        throw error;
    }

    return prisma.grade.update({
        where: { id },
        data,
    });
};

const deleteGrade = async (id) => {
    const existingGrade = await prisma.grade.findUnique({
        where: { id },
        select: {
            id: true,
            published: true,
        },
    });

    if (!existingGrade) {
        const error = new Error('Note introuvable.');
        error.code = 'GRADE_NOT_FOUND';
        throw error;
    }

    if (existingGrade.published) {
        const error = new Error(
            'Note déjà publiée, impossible de supprimer. Veuillez d’abord la dépublier.'
        );
        error.code = PUBLISHED_GRADE_LOCK_ERROR;
        throw error;
    }

    return prisma.grade.delete({
        where: { id },
    });
};

const toggleGradePublish = async (id, currentPublished) => {
    return prisma.grade.update({
        where: { id },
        data: {
            published: !currentPublished,
        },
    });
};
const publishGradesBatch = async (ids = []) => {
    if (!Array.isArray(ids) || !ids.length) {
        return { count: 0 };
    }

    return prisma.grade.updateMany({
        where: {
            id: { in: ids },
            published: false,
        },
        data: {
            published: true,
        },
    });
};
const unpublishGradesBatch = async (ids = []) => {
    if (!Array.isArray(ids) || !ids.length) {
        return { count: 0 };
    }

    return prisma.grade.updateMany({
        where: {
            id: { in: ids },
            published: true,
        },
        data: {
            published: false,
        },
    });
};

const studentBelongsToCourseProgram = async (studentId, courseId, studentScopeWhere = {}) => {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: {
            id: true,
            programId: true,
            code: true,
        },
    });

    if (!course) {
        return {
            ok: false,
            message: 'Le cours sélectionné est introuvable.',
        };
    }

    const student = await prisma.student.findFirst({
        where: {
            id: studentId,
            ...studentScopeWhere,
        },
        select: {
            id: true,
            matricule: true,
        },
    });

    if (!student) {
        return {
            ok: false,
            message: 'L’étudiant sélectionné est introuvable ou hors de votre périmètre.',
        };
    }

    const enrollment = await prisma.enrollment.findFirst({
        where: {
            studentId,
            programId: course.programId,
        },
        select: {
            id: true,
            class: {
                select: {
                    id: true,
                    campusId: true,
                    departmentId: true,
                },
            },
        },
    });

    if (!enrollment) {
        return {
            ok: false,
            message:
                'Incohérence métier : cet étudiant n’est pas inscrit dans le programme du cours sélectionné.',
        };
    }

    return { ok: true };
};

module.exports = {
    getStudentsForGradeForm,
    getCoursesForGradeForm,
    getGradesWithRelations,
    getGradeById,
    getGradeWithPublishContext,
    getGradeWithRelations,
    createGrade,
    updateGrade,
    deleteGrade,
    toggleGradePublish,
    publishGradesBatch,
    unpublishGradesBatch,
    studentBelongsToCourseProgram,
    PUBLISHED_GRADE_LOCK_ERROR,
};