const prisma = require('../lib/prisma');

/*
 * Service de gestion des départements.
 * Permet de récupérer, créer, mettre à jour ou supprimer
 * des départements en associant chaque département à son campus.
 */

const getDepartments = async () => {
    return prisma.department.findMany({
        orderBy: { nom: 'asc' },
        include: {
            campus: true,
            _count: {
                select: {
                    classes: true,
                    professors: true,
                    adminUsers: true,
                },
            },
        },
    });
};

const getDepartmentById = async (id) => {
    return prisma.department.findUnique({
        where: { id },
        include: { campus: true },
    });
};

const getDepartmentDeletionState = async (id) => {
    return prisma.department.findUnique({
        where: { id },
        select: {
            id: true,
            nom: true,
            _count: {
                select: {
                    classes: true,
                    professors: true,
                    adminUsers: true,
                },
            },
        },
    });
};

const createDepartment = async (data) => {
    return prisma.department.create({ data });
};

const updateDepartment = async (id, data) => {
    return prisma.department.update({ where: { id }, data });
};

const deleteDepartment = async (id) => {
    return prisma.department.delete({ where: { id } });
};

module.exports = {
    getDepartments,
    getDepartmentById,
    getDepartmentDeletionState,
    createDepartment,
    updateDepartment,
    deleteDepartment,
};