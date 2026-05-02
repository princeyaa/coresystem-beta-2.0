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
const importService = require('../services/importService');
const {
    safeWriteAuditLog,
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
} = require('../services/auditService');

function isLocalAdminMisconfigured(admin) {
    return admin && !isGlobalAdmin(admin) && !admin.campusId;
}

async function clearStudentImportState(req) {
    await deletePendingImportFile(req.session.studentImportPendingFile);
    delete req.session.studentImportPendingFile;
    delete req.session.studentImportDraft;
    delete req.session.studentImportReport;
}

async function renderStudentImportUpload(req, res, options = {}) {
    return res.render('admin/students/import-upload', {
        pageTitle: 'Import étudiants',
        maxRows: importService.MAX_IMPORT_ROWS,
        csvContent: options.csvContent || '',
        error: options.error || null,
        sheetSelection: options.sheetSelection || null,
        session: req.session,
    });
}

function buildSheetSelectionViewModel(result, selectedSheetName = '') {
    return {
        requiresChoice: true,
        fileName: result.originalname,
        sheetNames: result.sheetNames || [],
        selectedSheetName: selectedSheetName || '',
    };
}

exports.studentImportForm = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    await clearStudentImportState(req);

    return renderStudentImportUpload(req, res);
};

exports.previewStudentImport = async (req, res) => {
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
            await deletePendingImportFile(req.session.studentImportPendingFile);
            delete req.session.studentImportPendingFile;

            const fileInspection = await inspectImportFile(req.file, selectedSheetName);

            if (fileInspection.status === 'sheet_selection_required') {
                req.session.studentImportPendingFile = await savePendingImportFile(req.file);

                return renderStudentImportUpload(req, res, {
                    csvContent: '',
                    sheetSelection: buildSheetSelectionViewModel(fileInspection),
                });
            }

            normalizedImportText = fileInspection.csvText;
        } else if (usePendingFile) {
            const pendingMeta = req.session.studentImportPendingFile;

            if (!pendingMeta) {
                throw new Error('Le fichier Excel en attente a expiré. Veuillez le téléverser à nouveau.');
            }

            const pendingFile = await loadPendingImportFile(pendingMeta);
            const fileInspection = await inspectImportFile(pendingFile, selectedSheetName);

            if (fileInspection.status === 'sheet_selection_required') {
                return renderStudentImportUpload(req, res, {
                    csvContent: '',
                    sheetSelection: buildSheetSelectionViewModel(fileInspection, selectedSheetName),
                });
            }

            normalizedImportText = fileInspection.csvText;
            await deletePendingImportFile(req.session.studentImportPendingFile);
            delete req.session.studentImportPendingFile;
        } else if (pastedCsvText) {
            normalizedImportText = pastedCsvText;
        } else {
            throw new Error('Veuillez coller un CSV ou téléverser un fichier .csv/.xlsx.');
        }

        const preview = await importService.buildStudentImportPreview({
            admin,
            csvContent: normalizedImportText,
        });

        req.session.studentImportDraft = preview.draft;

        return res.render('admin/students/import-preview', {
            pageTitle: 'Prévisualisation import étudiants',
            preview,
            session: req.session,
        });
    } catch (error) {
        console.error('Erreur prévisualisation import étudiants :', error);

        let sheetSelection = null;

        if (req.body.usePendingFile === '1' && req.session.studentImportPendingFile) {
            try {
                const pendingFile = await loadPendingImportFile(req.session.studentImportPendingFile);
                const fileInspection = await inspectImportFile(pendingFile);

                if (fileInspection.status === 'sheet_selection_required') {
                    sheetSelection = buildSheetSelectionViewModel(fileInspection, selectedSheetName);
                }
            } catch (inspectionError) {
                console.error('Erreur récupération feuilles Excel en attente :', inspectionError);
            }
        }

        return renderStudentImportUpload(req, res, {
            csvContent,
            error:
                error && error.message
                    ? error.message
                    : 'Impossible d’analyser le fichier importé.',
            sheetSelection,
        });
    }
};

exports.confirmStudentImport = async (req, res) => {
    try {
        const admin = await resolveCurrentAdmin(req);

        if (isLocalAdminMisconfigured(admin)) {
            setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
            return res.redirect('/admin/dashboard');
        }

        const draft = req.session.studentImportDraft;

        if (!draft) {
            setFlash(req, 'error', 'Aucun aperçu d’import à confirmer.');
            return res.redirect('/admin/students/import');
        }

        if (draft.ownerAdminId !== admin.id) {
            setFlash(req, 'error', 'Cet aperçu d’import ne vous appartient pas.');
            return res.redirect('/admin/students/import');
        }

        if (!isGlobalAdmin(admin) && draft.ownerCampusId !== admin.campusId) {
            setFlash(req, 'error', 'Le périmètre de cet import ne correspond plus à votre campus.');
            return res.redirect('/admin/students/import');
        }

        const report = await importService.confirmStudentImport({ draft });

        for (const row of report.rows) {
            if (!row.studentId || row.status === 'rejected') {
                continue;
            }

            await safeWriteAuditLog({
                req,
                entityType: AUDIT_ENTITY_TYPES.STUDENT,
                entityId: row.studentId,
                action: row.status === 'created' ? AUDIT_ACTIONS.CREATE : AUDIT_ACTIONS.UPDATE,
                campusId:
                    row.afterSnapshot &&
                        row.afterSnapshot.currentEnrollment &&
                        row.afterSnapshot.currentEnrollment.campusId
                        ? row.afterSnapshot.currentEnrollment.campusId
                        : null,
                summary:
                    row.status === 'created'
                        ? `Import étudiant ${row.matricule}`
                        : `Import étudiant ${row.matricule} (mise à jour)`,
                beforeData: row.beforeSnapshot || null,
                afterData: row.afterSnapshot || null,
            });
        }

        req.session.studentImportReport = report;
        delete req.session.studentImportDraft;

        await deletePendingImportFile(req.session.studentImportPendingFile);
        delete req.session.studentImportPendingFile;

        return res.redirect('/admin/students/import/report');
    } catch (error) {
        console.error('Erreur confirmation import étudiants :', error);
        setFlash(req, 'error', 'Impossible de confirmer cet import.');
        return res.redirect('/admin/students/import');
    }
};

exports.studentImportReport = async (req, res) => {
    const admin = await resolveCurrentAdmin(req);

    if (isLocalAdminMisconfigured(admin)) {
        setFlash(req, 'error', 'Votre compte administrateur n’est rattaché à aucun campus.');
        return res.redirect('/admin/dashboard');
    }

    const report = req.session.studentImportReport;

    if (!report) {
        setFlash(req, 'error', 'Aucun rapport d’import disponible.');
        return res.redirect('/admin/students/import');
    }

    return res.render('admin/students/import-report', {
        pageTitle: 'Rapport import étudiants',
        report,
        session: req.session,
    });
};