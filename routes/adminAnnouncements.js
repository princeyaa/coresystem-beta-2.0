const express = require('express');
const router = express.Router();

const adminAnnouncementController = require('../controllers/adminAnnouncementController');
const { ensureAdminRole } = require('../middlewares/permissions');


const canManageAnnouncements = ensureAdminRole('ADMIN_CAMPUS');

router.get('/admin/announcements', canManageAnnouncements, adminAnnouncementController.index);
router.get('/admin/announcements/new', canManageAnnouncements, adminAnnouncementController.createForm);
router.post('/admin/announcements', canManageAnnouncements, adminAnnouncementController.store);
router.get('/admin/announcements/:id/edit', canManageAnnouncements, adminAnnouncementController.editForm);
router.post('/admin/announcements/:id', canManageAnnouncements, adminAnnouncementController.update);
router.post('/admin/announcements/:id/delete', canManageAnnouncements, adminAnnouncementController.destroy);

module.exports = router;