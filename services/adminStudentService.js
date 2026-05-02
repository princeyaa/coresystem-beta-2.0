const prisma = require('../lib/prisma');

/*
 * Service de gestion des étudiants côté administration.
 *
 * Scope :
 * Student -> Enrollment -> AcademicClass
 *
 * On manipule ici l'étudiant et son inscription "courante"
 * via le dernier enrollment connu.
 */

const getStudents = async (where = {}) => {
    return prisma.student.findMany({
        where,
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
            _count: {
                select: {
                    grades: true,
                    requests: true,
                    enrollments: true,
                },
            },
        },
    });
};

const getStudentById = async (id, where = {}) => {
    return prisma.student.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            enrollments: {
                orderBy: [{ createdAt: 'desc' }],
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
            _count: {
                select: {
                    grades: true,
                    requests: true,
                    enrollments: true,
                },
            },
        },
    });
};
const getStudentDetails = async (id, where = {}) => {
    return prisma.student.findFirst({
        where: {
            id,
            ...where,
        },
        include: {
            enrollments: {
                orderBy: [{ createdAt: 'desc' }],
                include: {
                    program: true,
                    class: {
                        include: {
                            campus: true,
                            department: true,
                            program: true,
                        },
                    },
                },
            },
            grades: {
                orderBy: [{ updatedAt: 'desc' }],
                include: {
                    course: {
                        include: {
                            program: true,
                        },
                    },
                },
            },
            requests: {
                orderBy: [{ createdAt: 'desc' }],
                include: {
                    treatedBy: true,
                },
            },
            _count: {
                select: {
                    grades: true,
                    requests: true,
                    enrollments: true,
                },
            },
        },
    });
};
const getStudentByMatricule = async (matricule) => {
    return prisma.student.findUnique({
        where: { matricule },
    });
};

const getStudentByEmail = async (email) => {
    return prisma.student.findFirst({
        where: { email },
    });
};

const getProgramsForStudentForm = async (where = {}) => {
    return prisma.program.findMany({
        where,
        orderBy: [{ filiere: 'asc' }, { niveau: 'asc' }],
    });
};

const getClassesForStudentForm = async (where = {}) => {
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

const createStudentWithEnrollment = async ({ studentData, enrollmentData }) => {
    return prisma.$transaction(async (tx) => {
        const student = await tx.student.create({
            data: studentData,
        });

        const enrollment = await tx.enrollment.create({
            data: {
                studentId: student.id,
                ...enrollmentData,
            },
        });

        return { student, enrollment };
    });
};

const updateStudentWithEnrollment = async ({
    studentId,
    studentData,
    enrollmentData,
    existingEnrollmentId = null,
}) => {
    return prisma.$transaction(async (tx) => {
        const student = await tx.student.update({
            where: { id: studentId },
            data: studentData,
        });

        let enrollment;

        if (existingEnrollmentId) {
            enrollment = await tx.enrollment.update({
                where: { id: existingEnrollmentId },
                data: enrollmentData,
            });
        } else {
            enrollment = await tx.enrollment.create({
                data: {
                    studentId,
                    ...enrollmentData,
                },
            });
        }

        return { student, enrollment };
    });
};

const updateStudentPassword = async (studentId, passwordHash) => {
    return prisma.student.update({
        where: { id: studentId },
        data: {
            password: passwordHash,
        },
    });
};

const deleteStudent = async (studentId) => {
    return prisma.student.delete({
        where: { id: studentId },
    });
};
const getCampusesForStudentFilters = async (where = {}) => {
    return prisma.campus.findMany({
        where,
        orderBy: [{ nom: 'asc' }],
    });
};

const getDepartmentsForStudentFilters = async (where = {}) => {
    return prisma.department.findMany({
        where,
        orderBy: [{ nom: 'asc' }],
        include: {
            campus: true,
        },
    });
};

const getAcademicYearsForStudentFilters = async (classWhere = {}) => {
    const classes = await prisma.academicClass.findMany({
        where: classWhere,
        select: {
            academicYear: true,
        },
        orderBy: [{ academicYear: 'desc' }],
    });

    return [...new Set(
        classes
            .map((academicClass) => academicClass.academicYear)
            .filter(Boolean)
    )];
};

module.exports = {
    getStudents,
    getStudentById,
    getStudentDetails,
    getStudentByMatricule,
    getStudentByEmail,
    getProgramsForStudentForm,
    getClassesForStudentForm,
    getCampusesForStudentFilters,
    getDepartmentsForStudentFilters,
    getAcademicYearsForStudentFilters,
    createStudentWithEnrollment,
    updateStudentWithEnrollment,
    updateStudentPassword,
    deleteStudent,
};