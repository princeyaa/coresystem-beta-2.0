const prisma = require('../lib/prisma');

/*
 * Service académique scoped.
 *
 * Important :
 * Program, Course et Schedule ne portent pas directement campusId/departmentId.
 * Le scope passe donc par :
 *
 * Program -> AcademicClass
 * Course -> Program -> AcademicClass
 * Schedule -> Course -> Program -> AcademicClass
 *
 * Ce n’est pas encore parfait pour une vraie V2 multi-campus,
 * mais c’est la meilleure solution sans migration.
 */

/* ---------------------------- PROGRAMS ---------------------------- */

const getProgramsWithCounts = async (where = {}) => {
    return prisma.program.findMany({
        where,
        orderBy: [{ filiere: 'asc' }, { niveau: 'asc' }],
        include: {
            _count: {
                select: {
                    courses: true,
                    enrollments: true,
                    announcements: true,
                    classes: true,
                },
            },
        },
    });
};

const getProgramsBasic = async (where = {}) => {
    return prisma.program.findMany({
        where,
        orderBy: [{ filiere: 'asc' }, { niveau: 'asc' }],
    });
};

const getProgramById = async (id, where = {}) => {
    return prisma.program.findFirst({
        where: {
            id,
            ...where,
        },
    });
};

const getProgramDeletionState = async (id, where = {}) => {
    return prisma.program.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            _count: {
                select: {
                    courses: true,
                    enrollments: true,
                    announcements: true,
                    classes: true,
                },
            },
        },
    });
};

const createProgram = async (data) => {
    return prisma.program.create({ data });
};

const updateProgram = async (id, data) => {
    return prisma.program.update({
        where: { id },
        data,
    });
};

const deleteProgram = async (id) => {
    return prisma.program.delete({
        where: { id },
    });
};

/* ----------------------------- COURSES ----------------------------- */

const getCoursesWithCounts = async (where = {}) => {
    return prisma.course.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        include: {
            program: true,
            _count: {
                select: {
                    schedules: true,
                    grades: true,
                    teachingAssignments: true,
                },
            },
        },
    });
};

const getCoursesWithProgram = async (where = {}) => {
    return prisma.course.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        include: {
            program: true,
        },
    });
};

const getCourseById = async (id, where = {}) => {
    return prisma.course.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            program: true,
        },
    });
};

const getCourseDeletionState = async (id, where = {}) => {
    return prisma.course.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            _count: {
                select: {
                    schedules: true,
                    grades: true,
                    teachingAssignments: true,
                },
            },
        },
    });
};

const createCourse = async (data) => {
    return prisma.course.create({ data });
};

const updateCourse = async (id, data) => {
    return prisma.course.update({
        where: { id },
        data,
    });
};

const deleteCourse = async (id) => {
    return prisma.course.delete({
        where: { id },
    });
};

/* ---------------------------- SCHEDULES ---------------------------- */

const getSchedulesWithRelations = async (where = {}) => {
    return prisma.schedule.findMany({
        where,
        include: {
            course: {
                include: {
                    program: true,
                },
            },
        },
    });
};

const getScheduleById = async (id, where = {}) => {
    return prisma.schedule.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            course: {
                include: {
                    program: true,
                },
            },
        },
    });
};

const createSchedule = async (data) => {
    return prisma.schedule.create({ data });
};

const updateSchedule = async (id, data) => {
    return prisma.schedule.update({
        where: { id },
        data,
    });
};

const deleteSchedule = async (id) => {
    return prisma.schedule.delete({
        where: { id },
    });
};

module.exports = {
    getProgramsWithCounts,
    getProgramsBasic,
    getProgramById,
    getProgramDeletionState,
    createProgram,
    updateProgram,
    deleteProgram,

    getCoursesWithCounts,
    getCoursesWithProgram,
    getCourseById,
    getCourseDeletionState,
    createCourse,
    updateCourse,
    deleteCourse,

    getSchedulesWithRelations,
    getScheduleById,
    createSchedule,
    updateSchedule,
    deleteSchedule,
};