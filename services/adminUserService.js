const prisma = require('../lib/prisma');

const getAdminUsers = async () => {
    return prisma.adminUser.findMany({
        orderBy: [{ role: 'asc' }, { nom: 'asc' }, { prenom: 'asc' }],
        include: {
            campus: true,
            department: true,
            _count: {
                select: {
                    announcements: true,
                    treatedRequests: true,
                },
            },
        },
    });
};

const getAdminUserById = async (id) => {
    return prisma.adminUser.findUnique({
        where: { id },
        include: {
            campus: true,
            department: true,
            _count: {
                select: {
                    announcements: true,
                    treatedRequests: true,
                },
            },
        },
    });
};

const getAdminUserByEmail = async (email) => {
    return prisma.adminUser.findUnique({
        where: { email },
    });
};

const createAdminUser = async (data) => {
    return prisma.adminUser.create({
        data,
    });
};

const updateAdminUser = async (id, data) => {
    return prisma.adminUser.update({
        where: { id },
        data,
    });
};

const updateAdminPassword = async (id, passwordHash) => {
    return prisma.adminUser.update({
        where: { id },
        data: {
            password: passwordHash,
        },
    });
};

const toggleAdminActiveState = async (id, isActive) => {
    return prisma.adminUser.update({
        where: { id },
        data: {
            isActive,
        },
    });
};

const deleteAdminUser = async (id) => {
    return prisma.adminUser.delete({
        where: { id },
    });
};

const countActiveSuperAdmins = async () => {
    return prisma.adminUser.count({
        where: {
            role: 'SUPER_ADMIN',
            isActive: true,
        },
    });
};

module.exports = {
    getAdminUsers,
    getAdminUserById,
    getAdminUserByEmail,
    createAdminUser,
    updateAdminUser,
    updateAdminPassword,
    toggleAdminActiveState,
    deleteAdminUser,
    countActiveSuperAdmins,
};