const express = require('express');
const router = express.Router();

const announcementsController = require('../controllers/announcementsController');
const { ensureStudent } = require('../middlewares/auth');

router.get('/announcements', ensureStudent, announcementsController.getAnnouncements);

module.exports = router;