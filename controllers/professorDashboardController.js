const prisma = require('../lib/prisma');
const { setFlash } = require('../utils/flash');
const {
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

exports.index = async (req, res) => {
    try {
        const professor = await prisma.professor.findUnique({
            where: { id: req.session.professorId },
            include: {
                campus: true,
                department: true,
                assignments: {
                    orderBy: [
                        { academicYear: 'desc' },
                        { createdAt: 'desc' },
                    ],
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
                                enrollments: {
                                    include: {
                                        student: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!professor || !professor.isActive) {
            setFlash(req, 'error', 'Compte professeur introuvable ou inactif.');
            return res.redirect('/professor/login');
        }

        const assignmentCount = professor.assignments.length;
        const courseCount = new Set(professor.assignments.map((a) => a.courseId)).size;
        const classCount = new Set(
            professor.assignments
                .filter((a) => a.classId)
                .map((a) => a.classId)
        ).size;

        const totalStudents = new Set(
            professor.assignments.flatMap((assignment) =>
                assignment.class && assignment.class.enrollments
                    ? assignment.class.enrollments.map((enrollment) => enrollment.studentId)
                    : []
            )
        ).size;

        const recentAssignments = professor.assignments.slice(0, 5);
        const assignmentIds = recentAssignments.map((assignment) => assignment.id);

        const latestAssignmentAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.TEACHING_ASSIGNMENT,
            assignmentIds
        );

        const assignmentTraceMap = {};
        recentAssignments.forEach((assignment) => {
            assignmentTraceMap[assignment.id] = toTraceMeta(
                latestAssignmentAudits[assignment.id],
                null
            );
        });

        return res.render('professor/dashboard', {
            pageTitle: 'Dashboard professeur',
            professor,
            assignmentCount,
            courseCount,
            classCount,
            totalStudents,
            recentAssignments,
            assignmentTraceMap,
        });
    } catch (error) {
        console.error('Erreur dashboard professeur :', error);
        return res.status(500).send('Erreur interne du serveur.');
    }
};