const express = require('express');
const router = express.Router();

const adminProgramController = require('../controllers/adminProgramController');
const { ensureAdminRole } = require('../middlewares/permissions');

const onlySuperAdmin = ensureAdminRole('SUPER_ADMIN');

router.get('/admin/programs', onlySuperAdmin, adminProgramController.index);
router.get('/admin/programs/new', onlySuperAdmin, adminProgramController.createForm);
router.post('/admin/programs', onlySuperAdmin, adminProgramController.store);
router.get('/admin/programs/:id/edit', onlySuperAdmin, adminProgramController.editForm);
router.post('/admin/programs/:id', onlySuperAdmin, adminProgramController.update);
router.post('/admin/programs/:id/delete', onlySuperAdmin, adminProgramController.destroy);

module.exports = router;