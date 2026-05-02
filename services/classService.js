const prisma = require('../lib/prisma');

/*
 * Service de gestion des classes académiques.
 * Les classes sont rattachées à un campus, un département et un programme.
 * Le paramètre where permet d’appliquer un scope admin sans dupliquer la logique.
 */

const getClasses = async (where = {}) => {
    return prisma.academicClass.findMany({
        where,
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
};

const getClassById = async (id, where = {}) => {
    return prisma.academicClass.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            campus: true,
            department: true,
            program: true,
        },
    });
};

const getClassDetails = async (id, where = {}) => {
    return prisma.academicClass.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            campus: true,
            department: true,
            program: true,
            enrollments: {
                orderBy: [{ createdAt: 'desc' }],
                include: {
                    student: true,
                    program: true,
                },
            },
            teachingAssignments: {
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
            },
            _count: {
                select: {
                    enrollments: true,
                    teachingAssignments: true,
                },
            },
        },
    });
};

const getRecentClassGrades = async (classId) => {
    return prisma.grade.findMany({
        where: {
            student: {
                enrollments: {
                    some: {
                        classId,
                    },
                },
            },
        },
        include: {
            student: true,
            course: {
                include: {
                    program: true,
                },
            },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 12,
    });
};

const getClassDeletionState = async (id, where = {}) => {
    return prisma.academicClass.findFirst({
        where: {
            id,
            ...where,
        },
        select: {
            id: true,
            nom: true,
            academicYear: true,
            campusId: true,
            departmentId: true,
            _count: {
                select: {
                    enrollments: true,
                    teachingAssignments: true,
                },
            },
        },
    });
};

const createClass = async (data) => {
    return prisma.academicClass.create({ data });
};

const updateClass = async (id, data) => {
    return prisma.academicClass.update({
        where: { id },
        data,
    });
};

const deleteClass = async (id) => {
    return prisma.academicClass.delete({
        where: { id },
    });
};

module.exports = {
    getClasses,
    getClassById,
    getClassDetails,
    getRecentClassGrades,
    getClassDeletionState,
    createClass,
    updateClass,
    deleteClass,
};