const express = require('express');
const router = express.Router();

const adminSearchController = require('../controllers/adminSearchController');
const { ensureAdminRole } = require('../middlewares/permissions');

const canSearchAdmin = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

router.get('/admin/search', canSearchAdmin, adminSearchController.index);

module.exports = router;