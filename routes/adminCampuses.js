const express = require('express');
const router = express.Router();

const adminCampusController = require('../controllers/adminCampusController');
const { ensureAdminRole } = require('../middlewares/permissions');

const onlySuperAdmin = ensureAdminRole('SUPER_ADMIN');

router.get('/admin/campuses', onlySuperAdmin, adminCampusController.index);
router.get('/admin/campuses/new', onlySuperAdmin, adminCampusController.createForm);
router.post('/admin/campuses', onlySuperAdmin, adminCampusController.store);
router.get('/admin/campuses/:id/edit', onlySuperAdmin, adminCampusController.editForm);
router.post('/admin/campuses/:id', onlySuperAdmin, adminCampusController.update);
router.post('/admin/campuses/:id/delete', onlySuperAdmin, adminCampusController.destroy);

module.exports = router;