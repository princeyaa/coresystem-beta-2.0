const express = require('express');
const router = express.Router();

const adminDepartmentController = require('../controllers/adminDepartmentController');
const { ensureAdminRole } = require('../middlewares/permissions');

const onlySuperAdmin = ensureAdminRole('SUPER_ADMIN');

router.get('/admin/departments', onlySuperAdmin, adminDepartmentController.index);
router.get('/admin/departments/new', onlySuperAdmin, adminDepartmentController.createForm);
router.post('/admin/departments', onlySuperAdmin, adminDepartmentController.store);
router.get('/admin/departments/:id/edit', onlySuperAdmin, adminDepartmentController.editForm);
router.post('/admin/departments/:id', onlySuperAdmin, adminDepartmentController.update);
router.post('/admin/departments/:id/delete', onlySuperAdmin, adminDepartmentController.destroy);

module.exports = router;