const express = require('express');
const router = express.Router();

const adminCourseController = require('../controllers/adminCourseController');
const { ensureAdminRole } = require('../middlewares/permissions');

const onlySuperAdmin = ensureAdminRole('SUPER_ADMIN');

router.get('/admin/courses', onlySuperAdmin, adminCourseController.index);
router.get('/admin/courses/new', onlySuperAdmin, adminCourseController.createForm);
router.post('/admin/courses', onlySuperAdmin, adminCourseController.store);
router.get('/admin/courses/:id/edit', onlySuperAdmin, adminCourseController.editForm);
router.post('/admin/courses/:id', onlySuperAdmin, adminCourseController.update);
router.post('/admin/courses/:id/delete', onlySuperAdmin, adminCourseController.destroy);

module.exports = router;