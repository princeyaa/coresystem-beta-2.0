const express = require('express');
const router = express.Router();

const scheduleController = require('../controllers/scheduleController');
const { ensureStudent } = require('../middlewares/auth');

router.get('/schedule', ensureStudent, scheduleController.getSchedule);

module.exports = router;