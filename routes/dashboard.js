const express = require('express');
const router = express.Router();

const dashboardController = require('../controllers/dashboardController');
const { ensureStudent } = require('../middlewares/auth');

router.get('/dashboard', ensureStudent, dashboardController.getDashboard);

module.exports = router;