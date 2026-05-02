const express = require('express');
const router = express.Router();

const adminDashboardController = require('../controllers/adminDashboardController');
const { ensureAdminRole } = require('../middlewares/permissions');

router.get(
    '/admin/dashboard',
    ensureAdminRole('SUPER_ADMIN', 'ADMIN_CAMPUS'),
    adminDashboardController.getDashboard
);

module.exports = router;