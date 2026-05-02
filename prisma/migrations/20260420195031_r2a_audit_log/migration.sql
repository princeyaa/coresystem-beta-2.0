-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(36) NOT NULL,
    `entityType` ENUM('ADMIN_USER', 'STUDENT', 'PROFESSOR', 'TEACHING_ASSIGNMENT', 'GRADE', 'REQUEST', 'ANNOUNCEMENT', 'ACADEMIC_CLASS', 'PROGRAM', 'COURSE', 'SCHEDULE', 'CAMPUS', 'DEPARTMENT', 'AUTH_SESSION') NOT NULL,
    `entityId` CHAR(36) NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'RESET_PASSWORD', 'ACTIVATE', 'DEACTIVATE', 'PUBLISH', 'UNPUBLISH', 'STATUS_CHANGE', 'LOGIN', 'LOGOUT') NOT NULL,
    `actorType` ENUM('ADMIN', 'PROFESSOR', 'STUDENT', 'SYSTEM') NOT NULL,
    `actorId` CHAR(36) NULL,
    `actorName` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(50) NULL,
    `campusId` CHAR(36) NULL,
    `summary` VARCHAR(255) NOT NULL,
    `beforeData` JSON NULL,
    `afterData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_actorType_actorId_idx`(`actorType`, `actorId`),
    INDEX `AuditLog_campusId_createdAt_idx`(`campusId`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
