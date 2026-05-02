const express = require('express');
const router = express.Router();

const adminScheduleController = require('../controllers/adminScheduleController');
const { ensureAdminRole } = require('../middlewares/permissions');

const onlySuperAdmin = ensureAdminRole('SUPER_ADMIN');

router.get('/admin/schedules', onlySuperAdmin, adminScheduleController.index);
router.get('/admin/schedules/new', onlySuperAdmin, adminScheduleController.createForm);
router.post('/admin/schedules', onlySuperAdmin, adminScheduleController.store);
router.get('/admin/schedules/:id/edit', onlySuperAdmin, adminScheduleController.editForm);
router.post('/admin/schedules/:id', onlySuperAdmin, adminScheduleController.update);
router.post('/admin/schedules/:id/delete', onlySuperAdmin, adminScheduleController.destroy);

module.exports = router;