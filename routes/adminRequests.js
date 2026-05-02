const express = require('express');
const router = express.Router();

const adminRequestController = require('../controllers/adminRequestController');
const { ensureAdminRole } = require('../middlewares/permissions');

const canManageRequests = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

router.get('/admin/requests', canManageRequests, adminRequestController.index);
router.get('/admin/requests/:id', canManageRequests, adminRequestController.show);

router.post('/admin/requests/:id/status', canManageRequests, adminRequestController.updateStatus);
router.post('/admin/requests/:id', canManageRequests, adminRequestController.updateStatus);

module.exports = router;