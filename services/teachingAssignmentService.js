const prisma = require('../lib/prisma');

/*
 * Service de gestion des affectations d’enseignement.
 *
 * Point important :
 * Un professeur peut enseigner dans plusieurs campus.
 * Le scope campus/département ne doit donc pas être appliqué sur Professor,
 * mais sur la classe liée à l’affectation.
 */

const getTeachingAssignments = async (where = {}) => {
    return prisma.teachingAssignment.findMany({
        where,
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
};

const getTeachingAssignmentById = async (id, where = {}) => {
    return prisma.teachingAssignment.findFirst({
        where: {
            id,
            ...where,
        },
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
};

const getTeachingAssignmentDeletionState = async (id, where = {}) => {
    return prisma.teachingAssignment.findFirst({
        where: {
            id,
            ...where,
        },
        select: {
            id: true,
            academicYear: true,
            professor: {
                select: {
                    nom: true,
                    prenom: true,
                },
            },
            course: {
                select: {
                    code: true,
                    nom: true,
                },
            },
            class: {
                select: {
                    nom: true,
                    academicYear: true,
                    campusId: true,
                    departmentId: true,
                },
            },
        },
    });
};

const getProfessorsForAssignment = async () => {
    return prisma.professor.findMany({
        where: {
            isActive: true,
        },
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        include: {
            campus: true,
            department: true,
        },
    });
};

const getCoursesForAssignment = async () => {
    return prisma.course.findMany({
        orderBy: { code: 'asc' },
        include: {
            program: true,
        },
    });
};

const getClassesForAssignment = async (where = {}) => {
    return prisma.academicClass.findMany({
        where,
        orderBy: [{ academicYear: 'desc' }, { nom: 'asc' }],
        include: {
            campus: true,
            department: true,
            program: true,
        },
    });
};

const getProfessorById = async (id) => {
    return prisma.professor.findUnique({
        where: { id },
    });
};

const getCourseById = async (id) => {
    return prisma.course.findUnique({
        where: { id },
        include: {
            program: true,
        },
    });
};

const getClassById = async (id) => {
    return prisma.academicClass.findUnique({
        where: { id },
        include: {
            campus: true,
            department: true,
            program: true,
        },
    });
};

const createTeachingAssignment = async (data) => {
    return prisma.teachingAssignment.create({ data });
};

const updateTeachingAssignment = async (id, data) => {
    return prisma.teachingAssignment.update({
        where: { id },
        data,
    });
};

const deleteTeachingAssignment = async (id) => {
    return prisma.teachingAssignment.delete({
        where: { id },
    });
};

module.exports = {
    getTeachingAssignments,
    getTeachingAssignmentById,
    getTeachingAssignmentDeletionState,
    getProfessorsForAssignment,
    getCoursesForAssignment,
    getClassesForAssignment,
    getProfessorById,
    getCourseById,
    getClassById,
    createTeachingAssignment,
    updateTeachingAssignment,
    deleteTeachingAssignment,
};