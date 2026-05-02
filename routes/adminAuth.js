const express = require('express');
const router = express.Router();

const adminAuthController = require('../controllers/adminAuthController');
const { ensureGuestAdmin } = require('../middlewares/auth');

router.get('/admin/login', ensureGuestAdmin, adminAuthController.getLogin);
router.post('/admin/login', ensureGuestAdmin, adminAuthController.postLogin);
router.get('/admin/logout', adminAuthController.logout);

module.exports = router;