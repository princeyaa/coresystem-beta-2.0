const express = require('express');
const router = express.Router();

const professorAuthController = require('../controllers/professorAuthController');
const { ensureGuestProfessor } = require('../middlewares/auth');

router.get('/professor/login', ensureGuestProfessor, professorAuthController.getLogin);
router.post('/professor/login', ensureGuestProfessor, professorAuthController.postLogin);
router.get('/professor/logout', professorAuthController.logout);

module.exports = router;