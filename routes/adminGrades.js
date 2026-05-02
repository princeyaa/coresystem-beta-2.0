const express = require('express');
const router = express.Router();

const adminGradeController = require('../controllers/adminGradeController');
const adminGradeImportController = require('../controllers/adminGradeImportController');
const { ensureAdminRole } = require('../middlewares/permissions');
const { importUpload } = require('../middlewares/importUpload');
const { verifyCsrfToken } = require('../middlewares/csrf');

const canManageGrades = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

router.get('/admin/grades', canManageGrades, adminGradeController.index);

// Import des notes
router.get(
    '/admin/grades/import',
    canManageGrades,
    adminGradeImportController.gradeImportForm
);

router.post(
    '/admin/grades/import/preview',
    canManageGrades,
    importUpload.single('importFile'),
    verifyCsrfToken,
    adminGradeImportController.previewGradeImport
);

router.post(
    '/admin/grades/import/confirm',
    canManageGrades,
    adminGradeImportController.confirmGradeImport
);

router.get(
    '/admin/grades/import/report',
    canManageGrades,
    adminGradeImportController.gradeImportReport
);

// Publication groupée
router.post('/admin/grades/publish-batch', canManageGrades, adminGradeController.publishBatch);
router.post('/admin/grades/unpublish-batch', canManageGrades, adminGradeController.unpublishBatch);

// CRUD notes
router.get('/admin/grades/new', canManageGrades, adminGradeController.createForm);
router.post('/admin/grades', canManageGrades, adminGradeController.store);
router.get('/admin/grades/:id/edit', canManageGrades, adminGradeController.editForm);
router.post('/admin/grades/:id', canManageGrades, adminGradeController.update);
router.post('/admin/grades/:id/toggle-publish', canManageGrades, adminGradeController.togglePublish);
router.post('/admin/grades/:id/delete', canManageGrades, adminGradeController.destroy);

module.exports = router;