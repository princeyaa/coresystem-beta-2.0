const express = require('express');
const router = express.Router();

const requestsController = require('../controllers/requestsController');
const { ensureStudent } = require('../middlewares/auth');

router.get('/requests', ensureStudent, requestsController.getRequests);
router.post('/requests', ensureStudent, requestsController.postRequest);

module.exports = router;