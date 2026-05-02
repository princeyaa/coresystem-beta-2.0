-- CreateTable
CREATE TABLE `ActiveSession` (
    `id` CHAR(36) NOT NULL,
    `actorType` ENUM('ADMIN', 'PROFESSOR', 'STUDENT', 'SYSTEM') NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `portal` VARCHAR(30) NOT NULL,
    `sessionId` VARCHAR(128) NOT NULL,
    `ipAddress` VARCHAR(80) NULL,
    `userAgent` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(80) NULL,

    INDEX `ActiveSession_actorType_actorId_revokedAt_idx`(`actorType`, `actorId`, `revokedAt`),
    INDEX `ActiveSession_sessionId_idx`(`sessionId`),
    INDEX `ActiveSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
