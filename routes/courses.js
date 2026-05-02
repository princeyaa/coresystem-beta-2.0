const express = require('express');
const router = express.Router();

const coursesController = require('../controllers/coursesController');
const { ensureStudent } = require('../middlewares/auth');

router.get('/courses', ensureStudent, coursesController.getCourses);

module.exports = router;