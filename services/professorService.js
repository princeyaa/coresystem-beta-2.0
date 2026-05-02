const prisma = require('../lib/prisma');

/*
 * Gestion des professeurs.
 *
 * Important :
 * campusId / departmentId sur Professor représentent un rattachement
 * administratif principal, pas une limite absolue des campus
 * d'enseignement. Le vrai multi-campus d'enseignement passe par
 * TeachingAssignment -> AcademicClass.
 */

const getProfessors = async (where = {}) => {
    return prisma.professor.findMany({
        where,
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
};

const getProfessorById = async (id, where = {}) => {
    return prisma.professor.findFirst({
        where: {
            id,
            ...where,
        },
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
};
const getProfessorDetails = async (id, where = {}) => {
    const professor = await prisma.professor.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            campus: true,
            department: true,
            assignments: {
                orderBy: [{ academicYear: 'desc' }, { createdAt: 'desc' }],
                include: {
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
                            enrollments: {
                                include: {
                                    student: true,
                                },
                            },
                        },
                    },
                },
            },
            _count: {
                select: {
                    assignments: true,
                },
            },
        },
    });

    if (!professor) {
        return null;
    }

    const gradeFilters = [];

    professor.assignments.forEach((assignment) => {
        const classEnrollments = assignment.class && assignment.class.enrollments
            ? assignment.class.enrollments
            : [];

        const studentIds = classEnrollments
            .map((enrollment) => enrollment.studentId)
            .filter(Boolean);

        if (studentIds.length) {
            gradeFilters.push({
                courseId: assignment.courseId,
                studentId: {
                    in: studentIds,
                },
            });
        } else {
            gradeFilters.push({
                courseId: assignment.courseId,
            });
        }
    });

    const recentGrades = gradeFilters.length
        ? await prisma.grade.findMany({
            where: {
                OR: gradeFilters,
            },
            orderBy: [{ updatedAt: 'desc' }],
            take: 10,
            include: {
                student: true,
                course: true,
            },
        })
        : [];

    return {
        ...professor,
        recentGrades,
    };
};

const getProfessorByEmail = async (email) => {
    return prisma.professor.findUnique({
        where: { email },
    });
};

const getProfessorDeletionState = async (id, where = {}) => {
    return prisma.professor.findFirst({
        where: {
            id,
            ...where,
        },
        select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            isActive: true,
            campusId: true,
            departmentId: true,
            _count: {
                select: {
                    assignments: true,
                },
            },
        },
    });
};

const createProfessor = async (data) => {
    return prisma.professor.create({
        data,
    });
};

const updateProfessor = async (id, data) => {
    return prisma.professor.update({
        where: { id },
        data,
    });
};

const updateProfessorPassword = async (id, passwordHash) => {
    return prisma.professor.update({
        where: { id },
        data: {
            password: passwordHash,
        },
    });
};

const toggleProfessorActiveState = async (id, isActive) => {
    return prisma.professor.update({
        where: { id },
        data: {
            isActive,
        },
    });
};

const deleteProfessor = async (id) => {
    return prisma.professor.delete({
        where: { id },
    });
};

module.exports = {
    getProfessors,
    getProfessorById,
    getProfessorDetails,
    getProfessorByEmail,
    getProfessorDeletionState,
    createProfessor,
    updateProfessor,
    updateProfessorPassword,
    toggleProfessorActiveState,
    deleteProfessor,
};