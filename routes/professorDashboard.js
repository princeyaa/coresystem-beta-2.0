const express = require('express');
const router = express.Router();

const professorDashboardController = require('../controllers/professorDashboardController');
const { ensureProfessor } = require('../middlewares/auth');

router.get('/professor/dashboard', ensureProfessor, professorDashboardController.index);

module.exports = router;