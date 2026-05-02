const prisma = require('../lib/prisma');

/*
 * Service de gestion des campus.
 * Chaque fonction renvoie une promesse Prisma. Ces méthodes
 * pourront être utilisées par les contrôleurs pour récupérer,
 * créer, mettre à jour ou supprimer des campus. Elles appliquent
 * un tri par nom afin d’obtenir un affichage cohérent.
 */

const getCampuses = async () => {
    return prisma.campus.findMany({
        orderBy: { nom: 'asc' },
        include: {
            _count: {
                select: {
                    departments: true,
                    classes: true,
                    professors: true,
                    adminUsers: true,
                },
            },
        },
    });
};

const getCampusById = async (id) => {
    return prisma.campus.findUnique({ where: { id } });
};

const getCampusDeletionState = async (id) => {
    return prisma.campus.findUnique({
        where: { id },
        select: {
            id: true,
            nom: true,
            _count: {
                select: {
                    departments: true,
                    classes: true,
                    professors: true,
                    adminUsers: true,
                },
            },
        },
    });
};

const createCampus = async (data) => {
    return prisma.campus.create({ data });
};

const updateCampus = async (id, data) => {
    return prisma.campus.update({ where: { id }, data });
};

const deleteCampus = async (id) => {
    return prisma.campus.delete({ where: { id } });
};

module.exports = {
    getCampuses,
    getCampusById,
    getCampusDeletionState,
    createCampus,
    updateCampus,
    deleteCampus,
};