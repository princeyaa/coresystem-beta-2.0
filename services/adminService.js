const prisma = require('../lib/prisma');

/* ---------------------------- PROGRAMS ---------------------------- */

const getProgramsWithCounts = async () => {
    return prisma.program.findMany({
        orderBy: [{ filiere: 'asc' }, { niveau: 'asc' }],
        include: {
            _count: {
                select: {
                    courses: true,
                    enrollments: true,
                    announcements: true,
                },
            },
        },
    });
};

const getProgramsBasic = async () => {
    return prisma.program.findMany({
        orderBy: [{ filiere: 'asc' }, { niveau: 'asc' }],
    });
};

const getProgramById = async (id) => {
    return prisma.program.findUnique({
        where: { id },
    });
};

const getProgramDeletionState = async (id) => {
    return prisma.program.findUnique({
        where: { id },
        select: {
            id: true,
            filiere: true,
            niveau: true,
            _count: {
                select: {
                    courses: true,
                    enrollments: true,
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

/* ----------------------------- COURSES ---------------------------- */

const getCoursesWithCounts = async () => {
    return prisma.course.findMany({
        orderBy: [{ createdAt: 'desc' }],
        include: {
            program: true,
            _count: {
                select: {
                    schedules: true,
                    grades: true,
                },
            },
        },
    });
};

const getCoursesWithProgram = async () => {
    return prisma.course.findMany({
        include: {
            program: true,
        },
        orderBy: [{ nom: 'asc' }],
    });
};

const getCourseById = async (id) => {
    return prisma.course.findUnique({
        where: { id },
    });
};

const getCourseDeletionState = async (id) => {
    return prisma.course.findUnique({
        where: { id },
        include: {
            _count: {
                select: {
                    schedules: true,
                    grades: true,
                },
            },
        },
    });
};

const courseExists = async (id) => {
    return prisma.course.findUnique({
        where: { id },
        select: { id: true },
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

/* ---------------------------- SCHEDULES --------------------------- */

const getSchedulesWithRelations = async () => {
    return prisma.schedule.findMany({
        include: {
            course: {
                include: {
                    program: true,
                },
            },
        },
    });
};

const getScheduleById = async (id) => {
    return prisma.schedule.findUnique({
        where: { id },
    });
};

const getScheduleWithCourse = async (id) => {
    return prisma.schedule.findUnique({
        where: { id },
        include: {
            course: true,
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

/* ----------------------------- STUDENTS --------------------------- */

const getStudentsBasic = async () => {
    return prisma.student.findMany({
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
};

const studentExists = async (id) => {
    return prisma.student.findUnique({
        where: { id },
        select: { id: true },
    });
};

/* ------------------------------ GRADES ---------------------------- */

const getGradesWithRelations = async () => {
    return prisma.grade.findMany({
        include: {
            student: true,
            course: {
                include: {
                    program: true,
                },
            },
        },
        orderBy: [{ createdAt: 'desc' }],
    });
};

const getGradeById = async (id) => {
    return prisma.grade.findUnique({
        where: { id },
    });
};

const getGradeWithPublishContext = async (id) => {
    return prisma.grade.findUnique({
        where: { id },
        select: {
            id: true,
            published: true,
            student: {
                select: {
                    prenom: true,
                    nom: true,
                },
            },
            course: {
                select: {
                    code: true,
                },
            },
        },
    });
};

const getGradeWithRelations = async (id) => {
    return prisma.grade.findUnique({
        where: { id },
        include: {
            student: true,
            course: true,
        },
    });
};

const createGrade = async (data) => {
    return prisma.grade.create({ data });
};

const updateGrade = async (id, data) => {
    return prisma.grade.update({
        where: { id },
        data,
    });
};

const deleteGrade = async (id) => {
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

const studentBelongsToCourseProgram = async (studentId, courseId) => {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: {
            id: true,
            programId: true,
        },
    });

    if (!course) {
        return {
            ok: false,
            message: 'Le cours sélectionné est introuvable.',
        };
    }

    const student = await studentExists(studentId);

    if (!student) {
        return {
            ok: false,
            message: 'L’étudiant sélectionné est introuvable.',
        };
    }

    const enrollment = await prisma.enrollment.findFirst({
        where: {
            studentId,
            programId: course.programId,
        },
        select: { id: true },
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

/* -------------------------- ANNOUNCEMENTS ------------------------- */

const getAnnouncementsWithFilters = async ({ scope, priority }) => {
    const where = {};

    if (scope === 'general') {
        where.programId = null;
    }

    if (scope === 'targeted') {
        where.programId = { not: null };
    }

    if (priority !== 'all') {
        where.priorite = priority;
    }

    return prisma.announcement.findMany({
        where,
        include: {
            author: true,
            program: true,
        },
        orderBy: [{ createdAt: 'desc' }],
    });
};

const getAnnouncementById = async (id) => {
    return prisma.announcement.findUnique({
        where: { id },
    });
};

const getAnnouncementDeleteTarget = async (id) => {
    return prisma.announcement.findUnique({
        where: { id },
        select: {
            id: true,
            titre: true,
        },
    });
};

const createAnnouncement = async (data) => {
    return prisma.announcement.create({ data });
};

const updateAnnouncement = async (id, data) => {
    return prisma.announcement.update({
        where: { id },
        data,
    });
};

const deleteAnnouncement = async (id) => {
    return prisma.announcement.delete({
        where: { id },
    });
};

/* ----------------------------- REQUESTS --------------------------- */

const getRequestsWithFilters = async ({ status, type }) => {
    const where = {};

    if (status !== 'all') {
        where.statut = status;
    }

    if (type !== 'all') {
        where.typeDemande = type;
    }

    return prisma.request.findMany({
        where,
        include: {
            student: true,
            treatedBy: true,
        },
        orderBy: [{ createdAt: 'desc' }],
    });
};

const getRequestWithRelations = async (id) => {
    return prisma.request.findUnique({
        where: { id },
        include: {
            student: true,
            treatedBy: true,
        },
    });
};

const requestExists = async (id) => {
    return prisma.request.findUnique({
        where: { id },
        select: { id: true },
    });
};

const updateRequestStatus = async (id, data) => {
    return prisma.request.update({
        where: { id },
        data,
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
    courseExists,
    createCourse,
    updateCourse,
    deleteCourse,

    getSchedulesWithRelations,
    getScheduleById,
    getScheduleWithCourse,
    createSchedule,
    updateSchedule,
    deleteSchedule,

    getStudentsBasic,
    studentExists,

    getGradesWithRelations,
    getGradeById,
    getGradeWithPublishContext,
    getGradeWithRelations,
    createGrade,
    updateGrade,
    deleteGrade,
    toggleGradePublish,
    studentBelongsToCourseProgram,

    getAnnouncementsWithFilters,
    getAnnouncementById,
    getAnnouncementDeleteTarget,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,

    getRequestsWithFilters,
    getRequestWithRelations,
    requestExists,
    updateRequestStatus,
};