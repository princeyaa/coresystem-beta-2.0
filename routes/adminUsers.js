const express = require('express');
const router = express.Router();

const adminUserController = require('../controllers/adminUserController');
const { ensureAdminRole } = require('../middlewares/permissions');

const onlySuperAdmin = ensureAdminRole('SUPER_ADMIN');

router.get('/admin/users', onlySuperAdmin, adminUserController.index);
router.get('/admin/users/new', onlySuperAdmin, adminUserController.createForm);
router.post('/admin/users', onlySuperAdmin, adminUserController.store);
router.get('/admin/users/:id/edit', onlySuperAdmin, adminUserController.editForm);
router.post('/admin/users/:id', onlySuperAdmin, adminUserController.update);
router.post('/admin/users/:id/toggle-active', onlySuperAdmin, adminUserController.toggleActive);
router.post('/admin/users/:id/reset-password', onlySuperAdmin, adminUserController.resetPassword);
router.post('/admin/users/:id/delete', onlySuperAdmin, adminUserController.destroy);

module.exports = router;