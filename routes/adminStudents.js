const express = require('express');
const router = express.Router();

const adminStudentController = require('../controllers/adminStudentController');
const adminImportController = require('../controllers/adminImportController');
const { ensureAdminRole } = require('../middlewares/permissions');
const { importUpload } = require('../middlewares/importUpload');
const { verifyCsrfToken } = require('../middlewares/csrf');

const canManageStudents = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

router.get('/admin/students', canManageStudents, adminStudentController.index);

router.get(
    '/admin/students/import',
    canManageStudents,
    adminImportController.studentImportForm
);

router.post(
    '/admin/students/import/preview',
    canManageStudents,
    importUpload.single('importFile'),
    verifyCsrfToken,
    adminImportController.previewStudentImport
);

router.post(
    '/admin/students/import/confirm',
    canManageStudents,
    adminImportController.confirmStudentImport
);

router.get(
    '/admin/students/import/report',
    canManageStudents,
    adminImportController.studentImportReport
);

router.get('/admin/students/new', canManageStudents, adminStudentController.createForm);
router.post('/admin/students', canManageStudents, adminStudentController.store);

router.get('/admin/students/:id', canManageStudents, adminStudentController.show);
router.get('/admin/students/:id/edit', canManageStudents, adminStudentController.editForm);
router.post('/admin/students/:id', canManageStudents, adminStudentController.update);
router.post('/admin/students/:id/reset-password', canManageStudents, adminStudentController.resetPassword);
router.post('/admin/students/:id/delete', canManageStudents, adminStudentController.destroy);

module.exports = router;