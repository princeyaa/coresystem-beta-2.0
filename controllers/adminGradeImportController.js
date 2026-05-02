const { setFlash } = require('../utils/flash');
const {
    inspectImportFile,
    extractPastedCsvText,
} = require('../utils/importFileParser');
const {
    savePendingImportFile,
    loadPendingImportFile,
    deletePendingImportFile,
} = require('../utils/pendingImportStore');
const {
    resolveCurrentAdmin,
    isGlobalAdmin,
} = require('../middlewares/permissions');
const {
    safeWriteAuditLog,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');
const gradeImportService = require('../services/gradeImportService');

function isLocalAdminMisconfigured(admin) {
    return admin && !isGlobalAdmin(admin) && !admin.campusId;
}

async function clearGradeImportState(req) {
    await deletePendingImportFile(req.session.gradeImportPendingFile);
    delete req.session.gradeImportPendingFile;
    delete req.session.gradeImportDraft;
    delete req.session.gradeImportReport;
}

function buildSheetSelectionViewModel(result, selectedSheetName = '') {
    return {
        requiresChoice: true,
        fileName: result.originalname,
        sheetNames: result.sheetNames || [],
        selectedSheetName: selectedSheetName || '',
    };
}

async function renderGradeImportUpload(req, res, options = {}) {
    const admin = options.admin || (await resolveCurrentAdmin(req));
    const classes = await gradeImportService.getImportClassesForAdmin(admin);

    return res.render('admin/grades/import-upload', {
        pageTitle: 'Import notes',
        classes,
        selectedClassId: options.selectedClassId || '',
        maxRows: gradeImportService.MAX_IMPORT_ROWS,
        csvContent: options.csvContent || '',
        error: options.error || null,
        sheetSelection: options.sheetSelection || null,
        session: req.session,
    });
}

exports.gradeImportForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    await clearGradeImportState(req);

    const selectedClassId =
        typeof req.query.classId === 'string' && req.query.classId.trim()
            ? req.query.classId.trim()
            : '';

    return renderGradeImportUpload(req, res, {
        admin,
        selectedClassId,
    });
};

exports.previewGradeImport = async (req, res) => {
    const classId = typeof req.body.classId === 'string' ? req.body.classId.trim() : '';
    const csvContent = typeof req.body.csvContent === 'string' ? req.body.csvContent : '';
    const selectedSheetName =
        typeof req.body.selectedSheetName === 'string' ? req.body.selectedSheetName.trim() : '';
    const usePendingFile = req.body.usePendingFile === '1';

    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        let normalizedImportText = '';
        const pastedCsvText = extractPastedCsvText(csvContent);

        if (req.file && req.file.buffer && req.file.buffer.length) {
            await deletePendingImportFile(req.session.gradeImportPendingFile);
            delete req.session.gradeImportPendingFile;

            const fileInspection = await inspectImportFile(req.file, selectedSheetName);

            if (fileInspection.status === 'sheet_selection_required') {
                req.session.gradeImportPendingFile = await savePendingImportFile(req.file);

                return renderGradeImportUpload(req, res, {
                    admin,
                    selectedClassId: classId,
                    csvContent: '',
                    sheetSelection: buildSheetSelectionViewModel(fileInspection),
                });
            }

            normalizedImportText = fileInspection.csvText;
        } else if (usePendingFile) {
            const pendingMeta = req.session.gradeImportPendingFile;

            if (!pendingMeta) {
                throw new Error('Le fichier Excel en attente a expiré. Veuillez le téléverser à nouveau.');
            }

            const pendingFile = await loadPendingImportFile(pendingMeta);
            const fileInspection = await inspectImportFile(pendingFile, selectedSheetName);

            if (fileInspection.status === 'sheet_selection_required') {
                return renderGradeImportUpload(req, res, {
                    admin,
                    selectedClassId: classId,
                    csvContent: '',
                    sheetSelection: buildSheetSelectionViewModel(fileInspection, selectedSheetName),
                });
            }

            normalizedImportText = fileInspection.csvText;
            await deletePendingImportFile(req.session.gradeImportPendingFile);
            delete req.session.gradeImportPendingFile;
        } else if (pastedCsvText) {
            normalizedImportText = pastedCsvText;
        } else {
            throw new Error('Veuillez coller un CSV ou téléverser un fichier .csv/.xlsx.');
        }

        const preview = await gradeImportService.buildGradeImportPreview({
            admin,
            classId,
            csvContent: normalizedImportText,
        });

        req.session.gradeImportDraft = preview.draft;

        return res.render('admin/grades/import-preview', {
            pageTitle: 'Prévisualisation import notes',
            preview,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur prévisualisation import notes :', error);

        const admin = await resolveCurrentAdmin(req);
        let sheetSelection = null;

        if (req.body.usePendingFile === '1' && req.session.gradeImportPendingFile) {
            try {
                const pendingFile = await loadPendingImportFile(req.session.gradeImportPendingFile);
                const fileInspection = await inspectImportFile(pendingFile);

                if (fileInspection.status === 'sheet_selection_required') {
                    sheetSelection = buildSheetSelectionViewModel(fileInspection, selectedSheetName);
                }
            } catch (inspectionError) {
                console.error('Erreur récupération feuilles Excel en attente :', inspectionError);
            }
        }

        return renderGradeImportUpload(req, res, {
            admin,
            selectedClassId: classId,
            csvContent,
            error:
                error && error.message
                    ? error.message
                    : 'Impossible d’analyser le fichier importé.',
            sheetSelection,
        });
    }
};

exports.confirmGradeImport = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const draft = req.session.gradeImportDraft;

        if (!draft) {
            setFlash(req, 'error', 'Aucun aperçu d’import à confirmer.');
            return res.redirect('/admin/grades/import');
        }

        if (draft.ownerAdminId !== admin.id) {
            setFlash(req, 'error', 'Cet aperçu d’import ne vous appartient pas.');
            return res.redirect('/admin/grades/import');
        }

        if (!isGlobalAdmin(admin) && draft.ownerCampusId !== admin.campusId) {
            setFlash(req, 'error', 'Le périmètre de cet import ne correspond plus à votre campus.');
            return res.redirect('/admin/grades/import');
        }

        const report = await gradeImportService.confirmGradeImport({ draft });

        for (const row of report.rows) {
            if (!row.gradeId || row.status === 'rejected') {
                continue;
            }

            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.GRADE,
                entityId: row.gradeId,
                action: row.status === 'created' ? AUDIT_ACTIONS.CREATE : AUDIT_ACTIONS.UPDATE,
                campusId: row.campusId || null,
                summary:
                    row.status === 'created'
                        ? `Import note ${row.display.typeEvaluation} - ${row.display.matricule} - ${row.display.courseCode}`
                        : `Import note ${row.display.typeEvaluation} - ${row.display.matricule} - ${row.display.courseCode} (mise à jour)`,
                beforeData: row.beforeSnapshot || null,
                afterData: row.afterSnapshot || null,
            });
        }

        req.session.gradeImportReport = report;
        delete req.session.gradeImportDraft;

        await deletePendingImportFile(req.session.gradeImportPendingFile);
        delete req.session.gradeImportPendingFile;

        return res.redirect('/admin/grades/import/report');
    } catch (error) {
        console.error('Erreur confirmation import notes :', error);
        setFlash(req, 'error', 'Impossible de confirmer cet import.');
        return res.redirect('/admin/grades/import');
    }
};

exports.gradeImportReport = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const report = req.session.gradeImportReport;

    if (!report) {
        setFlash(req, 'error', 'Aucun rapport d’import disponible.');
        return res.redirect('/admin/grades/import');
    }

    const classContext = await gradeImportService.getScopedClassContext(admin, report.classId);

    return res.render('admin/grades/import-report', {
        pageTitle: 'Rapport import notes',
        report,
        classContext,
        session: req.session,
    });
};