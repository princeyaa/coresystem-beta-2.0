const express = require('express');
const router = express.Router();

const adminClassController = require('../controllers/adminClassController');
const { ensureAdminRole } = require('../middlewares/permissions');

const canManageClasses = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

router.get('/admin/classes', canManageClasses, adminClassController.index);
router.get('/admin/classes/new', canManageClasses, adminClassController.createForm);
router.post('/admin/classes', canManageClasses, adminClassController.store);
router.get('/admin/classes/:id', canManageClasses, adminClassController.show);
router.get('/admin/classes/:id/edit', canManageClasses, adminClassController.editForm);
router.post('/admin/classes/:id', canManageClasses, adminClassController.update);
router.post('/admin/classes/:id/delete', canManageClasses, adminClassController.destroy);

module.exports = router;