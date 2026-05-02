const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { ensureGuestStudent } = require('../middlewares/auth');

router.get('/login', ensureGuestStudent, authController.getLogin);
router.post('/login', ensureGuestStudent, authController.postLogin);
router.get('/logout', authController.logout);

module.exports = router;