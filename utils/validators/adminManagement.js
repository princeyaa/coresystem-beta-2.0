const { EvalType, RequestStatus, RequestType } = require('@prisma/client');
const {
    normalizeText,
    normalizeUpper,
    nullableText,
    isPositiveOrZeroNumber,
} = require('./common');

/* ----------------------------- SCHEDULES ----------------------------- */

const ALLOWED_DAYS = [
    'LUNDI',
    'MARDI',
    'MERCREDI',
    'JEUDI',
    'VENDREDI',
    'SAMEDI',
];

const ALLOWED_SCHEDULE_STATUSES = ['NORMAL', 'MODIFIE', 'ANNULE'];

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const sanitizeScheduleInput = (body = {}) => ({
    jour: normalizeUpper(body.jour),
    heureDebut: normalizeText(body.heureDebut),
    heureFin: normalizeText(body.heureFin),
    salle: nullableText(body.salle),
    statut: normalizeUpper(body.statut),
    courseId: normalizeText(body.courseId),
});

const buildScheduleForm = (schedule = {}) => ({
    jour: schedule.jour || '',
    heureDebut: schedule.heureDebut || '',
    heureFin: schedule.heureFin || '',
    salle: schedule.salle || '',
    statut: schedule.statut || 'NORMAL',
    courseId: schedule.courseId || '',
});

const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

const validateScheduleData = (scheduleData) => {
    if (
        !scheduleData.jour ||
        !scheduleData.heureDebut ||
        !scheduleData.heureFin ||
        !scheduleData.statut ||
        !scheduleData.courseId
    ) {
        return 'Le jour, les heures, le statut et le cours sont obligatoires.';
    }

    if (!ALLOWED_DAYS.includes(scheduleData.jour)) {
        return 'Le jour sélectionné est invalide.';
    }

    if (!ALLOWED_SCHEDULE_STATUSES.includes(scheduleData.statut)) {
        return 'Le statut sélectionné est invalide.';
    }

    if (!TIME_REGEX.test(scheduleData.heureDebut)) {
        return 'L’heure de début doit être au format HH:MM.';
    }

    if (!TIME_REGEX.test(scheduleData.heureFin)) {
        return 'L’heure de fin doit être au format HH:MM.';
    }

    if (timeToMinutes(scheduleData.heureFin) <= timeToMinutes(scheduleData.heureDebut)) {
        return 'L’heure de fin doit être strictement après l’heure de début.';
    }

    return null;
};

/* ------------------------------ GRADES ------------------------------ */

const ALLOWED_EVAL_TYPES = Object.values(EvalType);

const sanitizeGradeInput = (body = {}) => ({
    typeEvaluation: normalizeUpper(body.typeEvaluation),
    valeur: Number.parseFloat(normalizeText(body.valeur)),
    published: body.published === 'on',
    studentId: normalizeText(body.studentId),
    courseId: normalizeText(body.courseId),
});

const buildGradeForm = (grade = {}) => ({
    typeEvaluation: grade.typeEvaluation || '',
    valeur:
        typeof grade.valeur === 'number' && !Number.isNaN(grade.valeur)
            ? grade.valeur
            : '',
    published: Boolean(grade.published),
    studentId: grade.studentId || '',
    courseId: grade.courseId || '',
});

const validateGradeData = (gradeData) => {
    if (!gradeData.studentId || !gradeData.courseId || !gradeData.typeEvaluation) {
        return 'L’étudiant, le cours et le type d’évaluation sont obligatoires.';
    }

    if (!ALLOWED_EVAL_TYPES.includes(gradeData.typeEvaluation)) {
        return 'Le type d’évaluation sélectionné est invalide.';
    }

    if (
        typeof gradeData.valeur !== 'number' ||
        Number.isNaN(gradeData.valeur)
    ) {
        return 'La note doit être un nombre valide.';
    }

    if (gradeData.valeur < 0 || gradeData.valeur > 20) {
        return 'La note doit être comprise entre 0 et 20.';
    }

    return null;
};

/* --------------------------- ANNOUNCEMENTS --------------------------- */

const ALLOWED_PRIORITIES = ['NORMALE', 'IMPORTANTE', 'URGENTE'];
const ALLOWED_SCOPES = ['all', 'general', 'targeted'];

const sanitizeAnnouncementInput = (body = {}) => ({
    titre: normalizeText(body.titre),
    contenu: normalizeText(body.contenu),
    priorite: normalizeUpper(body.priorite),
    programId: normalizeText(body.programId) || null,
    expiresAtRaw: normalizeText(body.expiresAt),
});

const toDateInputValue = (date) => {
    if (!date) return '';

    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
};

const buildAnnouncementForm = (announcement = {}) => ({
    titre: announcement.titre || '',
    contenu: announcement.contenu || '',
    priorite: announcement.priorite || 'NORMALE',
    programId: announcement.programId || '',
    expiresAt: announcement.expiresAt
        ? toDateInputValue(announcement.expiresAt)
        : announcement.expiresAtRaw || '',
});

const parseExpiresAt = (expiresAtRaw) => {
    if (!expiresAtRaw) {
        return { value: null, error: null };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateRegex.test(expiresAtRaw)) {
        return {
            value: null,
            error: 'La date d’expiration est invalide.',
        };
    }

    const expiresAt = new Date(`${expiresAtRaw}T23:59:59`);

    if (Number.isNaN(expiresAt.getTime())) {
        return {
            value: null,
            error: 'La date d’expiration est invalide.',
        };
    }

    return { value: expiresAt, error: null };
};

const validateAnnouncementData = (announcementData, expiresAtError) => {
    if (!announcementData.titre || !announcementData.contenu) {
        return 'Le titre et le contenu sont obligatoires.';
    }

    if (!ALLOWED_PRIORITIES.includes(announcementData.priorite)) {
        return 'La priorité sélectionnée est invalide.';
    }

    if (expiresAtError) {
        return expiresAtError;
    }

    return null;
};

/* ------------------------------ REQUESTS ----------------------------- */

const ALL_REQUEST_TYPES = Object.values(RequestType);
const ALL_REQUEST_STATUSES = Object.values(RequestStatus);
const ALLOWED_TARGET_REQUEST_STATUSES = [
    RequestStatus.EN_TRAITEMENT,
    RequestStatus.TRAITEE,
    RequestStatus.REJETEE,
];

const sanitizeRequestStatusUpdate = (body = {}) => ({
    statut: normalizeUpper(body.statut),
    commentaire: nullableText(body.commentaire),
});

const validateRequestStatusUpdate = (updateData) => {
    if (!ALLOWED_TARGET_REQUEST_STATUSES.includes(updateData.statut)) {
        return 'Le statut choisi est invalide.';
    }

    if (updateData.statut === RequestStatus.REJETEE && !updateData.commentaire) {
        return 'Un commentaire est obligatoire pour rejeter une demande.';
    }

    return null;
};

module.exports = {
    ALLOWED_DAYS,
    ALLOWED_SCHEDULE_STATUSES,
    sanitizeScheduleInput,
    buildScheduleForm,
    validateScheduleData,

    ALLOWED_EVAL_TYPES,
    sanitizeGradeInput,
    buildGradeForm,
    validateGradeData,

    ALLOWED_PRIORITIES,
    ALLOWED_SCOPES,
    sanitizeAnnouncementInput,
    buildAnnouncementForm,
    parseExpiresAt,
    validateAnnouncementData,

    ALL_REQUEST_TYPES,
    ALL_REQUEST_STATUSES,
    ALLOWED_TARGET_REQUEST_STATUSES,
    sanitizeRequestStatusUpdate,
    validateRequestStatusUpdate,
};