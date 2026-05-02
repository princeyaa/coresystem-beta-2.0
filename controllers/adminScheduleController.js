const { setFlash } = require('../utils/flash');
const {
    ALLOWED_DAYS,
    ALLOWED_SCHEDULE_STATUSES,
    sanitizeScheduleInput,
    buildScheduleForm,
    validateScheduleData,
} = require('../utils/validators/adminManagement');
const adminService = require('../services/adminService');
const {
    safeWriteAuditLog,
    getLatestAuditMap,
    toTraceMeta,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

const dayOrder = {
    LUNDI: 1,
    MARDI: 2,
    MERCREDI: 3,
    JEUDI: 4,
    VENDREDI: 5,
    SAMEDI: 6,
};

const sortSchedules = (schedules) => {
    return schedules.sort((a, b) => {
        const dayCompare = dayOrder[a.jour] - dayOrder[b.jour];
        if (dayCompare !== 0) return dayCompare;
        return a.heureDebut.localeCompare(b.heureDebut);
    });
};

function buildScheduleAuditSnapshot(schedule) {
    if (!schedule) return null;

    return {
        id: schedule.id,
        jour: schedule.jour,
        heureDebut: schedule.heureDebut,
        heureFin: schedule.heureFin,
        salle: schedule.salle,
        statut: schedule.statut,
        courseId: schedule.courseId || (schedule.course ? schedule.course.id : null),
        courseCode: schedule.course ? schedule.course.code : null,
        courseNom: schedule.course ? schedule.course.nom : null,
        programLabel:
            schedule.course && schedule.course.program
                ? `${schedule.course.program.filiere} ${schedule.course.program.niveau}`
                : null,
    };
}

const renderForm = async (res, options) => {
    const courses = await adminService.getCoursesWithProgram();

    return res.render('admin/schedules/form', {
        pageTitle: options.pageTitle,
        formAction: options.formAction,
        submitLabel: options.submitLabel,
        schedule: options.schedule,
        courses,
        allowedDays: ALLOWED_DAYS,
        allowedStatuses: ALLOWED_SCHEDULE_STATUSES,
        error: options.error || null,
        session: options.session,
    });
};

exports.index = async (req, res) => {
    try {
        const schedules = sortSchedules(await adminService.getSchedulesWithRelations());

        const latestScheduleAudits = await getLatestAuditMap(
            AUDIT_ENTITY_TYPES.SCHEDULE,
            schedules.map((schedule) => schedule.id)
        );

        const scheduleTraceMap = {};
        schedules.forEach((schedule) => {
            scheduleTraceMap[schedule.id] = toTraceMeta(
                latestScheduleAudits[schedule.id],
                null
            );
        });

        return res.render('admin/schedules/index', {
            schedules,
            scheduleTraceMap,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement créneaux admin :', error);
        setFlash(req, 'error', 'Impossible de charger les créneaux.');
        return res.redirect('/admin/dashboard');
    }
};

exports.createForm = async (req, res) => {
    try {
        const courses = await adminService.getCoursesWithProgram();

        if (!courses.length) {
            setFlash(req, 'error', 'Crée d’abord au moins un cours avant d’ajouter un créneau.');
            return res.redirect('/admin/courses');
        }

        return res.render('admin/schedules/form', {
            pageTitle: 'Nouveau créneau',
            formAction: '/admin/schedules',
            submitLabel: 'Créer le créneau',
            schedule: buildScheduleForm(),
            courses,
            allowedDays: ALLOWED_DAYS,
            allowedStatuses: ALLOWED_SCHEDULE_STATUSES,
            error: null,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire création créneau :', error);
        setFlash(req, 'error', 'Impossible de charger le formulaire de création.');
        return res.redirect('/admin/schedules');
    }
};

exports.store = async (req, res) => {
    const scheduleData = sanitizeScheduleInput(req.body);
    const validationError = validateScheduleData(scheduleData);

    if (validationError) {
        return await renderForm(res, {
            pageTitle: 'Nouveau créneau',
            formAction: '/admin/schedules',
            submitLabel: 'Créer le créneau',
            schedule: buildScheduleForm(scheduleData),
            error: validationError,
            session: req.session,
        });
    }

    try {
        const courseExists = await adminService.getCourseById(scheduleData.courseId);

        if (!courseExists) {
            return await renderForm(res, {
                pageTitle: 'Nouveau créneau',
                formAction: '/admin/schedules',
                submitLabel: 'Créer le créneau',
                schedule: buildScheduleForm(scheduleData),
                error: 'Le cours sélectionné est introuvable.',
                session: req.session,
            });
        }

        const createdSchedule = await adminService.createSchedule(scheduleData);
        const fullSchedule = createdSchedule?.id
            ? await adminService.getScheduleById(createdSchedule.id)
            : null;

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.SCHEDULE,
            entityId: createdSchedule ? createdSchedule.id : null,
            action: AUDIT_ACTIONS.CREATE,
            summary: `Création d’un créneau ${scheduleData.jour} ${scheduleData.heureDebut}-${scheduleData.heureFin}`,
            beforeData: null,
            afterData: buildScheduleAuditSnapshot(fullSchedule) || scheduleData,
        });

        setFlash(req, 'success', 'Créneau créé avec succès.');
        return res.redirect('/admin/schedules');
    } catch (error) {
        console.error('Erreur création créneau :', error);

        return await renderForm(res, {
            pageTitle: 'Nouveau créneau',
            formAction: '/admin/schedules',
            submitLabel: 'Créer le créneau',
            schedule: buildScheduleForm(scheduleData),
            error: 'Une erreur est survenue lors de la création.',
            session: req.session,
        });
    }
};

exports.editForm = async (req, res) => {
    try {
        const schedule = await adminService.getScheduleById(req.params.id);

        if (!schedule) {
            setFlash(req, 'error', 'Créneau introuvable.');
            return res.redirect('/admin/schedules');
        }

        return await renderForm(res, {
            pageTitle: 'Modifier le créneau',
            formAction: `/admin/schedules/${schedule.id}`,
            submitLabel: 'Enregistrer les modifications',
            schedule: buildScheduleForm(schedule),
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur chargement formulaire édition créneau :', error);
        setFlash(req, 'error', 'Impossible de charger ce créneau.');
        return res.redirect('/admin/schedules');
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const scheduleData = sanitizeScheduleInput(req.body);
    const validationError = validateScheduleData(scheduleData);

    if (validationError) {
        return await renderForm(res, {
            pageTitle: 'Modifier le créneau',
            formAction: `/admin/schedules/${id}`,
            submitLabel: 'Enregistrer les modifications',
            schedule: buildScheduleForm(scheduleData),
            error: validationError,
            session: req.session,
        });
    }

    try {
        const existingSchedule = await adminService.getScheduleById(id);

        if (!existingSchedule) {
            setFlash(req, 'error', 'Créneau introuvable.');
            return res.redirect('/admin/schedules');
        }

        const courseExists = await adminService.getCourseById(scheduleData.courseId);

        if (!courseExists) {
            return await renderForm(res, {
                pageTitle: 'Modifier le créneau',
                formAction: `/admin/schedules/${id}`,
                submitLabel: 'Enregistrer les modifications',
                schedule: buildScheduleForm(scheduleData),
                error: 'Le cours sélectionné est introuvable.',
                session: req.session,
            });
        }

        await adminService.updateSchedule(id, scheduleData);
        const updatedSchedule = await adminService.getScheduleById(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.SCHEDULE,
            entityId: id,
            action: AUDIT_ACTIONS.UPDATE,
            summary: `Modification du créneau ${scheduleData.jour} ${scheduleData.heureDebut}-${scheduleData.heureFin}`,
            beforeData: buildScheduleAuditSnapshot(existingSchedule),
            afterData: buildScheduleAuditSnapshot(updatedSchedule) || scheduleData,
        });

        setFlash(req, 'success', 'Créneau mis à jour avec succès.');
        return res.redirect('/admin/schedules');
    } catch (error) {
        console.error('Erreur mise à jour créneau :', error);

        if (error.code === 'P2025') {
            setFlash(req, 'error', 'Créneau introuvable.');
            return res.redirect('/admin/schedules');
        }

        return await renderForm(res, {
            pageTitle: 'Modifier le créneau',
            formAction: `/admin/schedules/${id}`,
            submitLabel: 'Enregistrer les modifications',
            schedule: buildScheduleForm(scheduleData),
            error: 'Une erreur est survenue lors de la mise à jour.',
            session: req.session,
        });
    }
};

exports.destroy = async (req, res) => {
    const { id } = req.params;

    try {
        const schedule = await adminService.getScheduleById(id);

        if (!schedule) {
            setFlash(req, 'error', 'Créneau introuvable.');
            return res.redirect('/admin/schedules');
        }

        await adminService.deleteSchedule(id);

        await safeWriteAuditLog({
            req,
            entityType: AUDIT_ENTITY_TYPES.SCHEDULE,
            entityId: id,
            action: AUDIT_ACTIONS.DELETE,
            summary: `Suppression du créneau ${schedule.jour} ${schedule.heureDebut}-${schedule.heureFin}`,
            beforeData: buildScheduleAuditSnapshot(schedule),
            afterData: null,
        });

        setFlash(req, 'success', `Créneau supprimé pour le cours ${schedule.course.code}.`);
        return res.redirect('/admin/schedules');
    } catch (error) {
        console.error('Erreur suppression créneau :', error);
        setFlash(req, 'error', 'Impossible de supprimer ce créneau.');
        return res.redirect('/admin/schedules');
    }
};