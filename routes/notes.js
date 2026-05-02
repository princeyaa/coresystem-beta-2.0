const express = require('express');
const router = express.Router();

const notesController = require('../controllers/notesController');
const { ensureStudent } = require('../middlewares/auth');

router.get('/notes', ensureStudent, notesController.getNotes);

module.exports = router;