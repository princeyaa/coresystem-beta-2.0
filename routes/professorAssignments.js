const express = require('express');
const router = express.Router();

const professorAssignmentsController = require('../controllers/professorAssignmentsController');
const { ensureProfessor } = require('../middlewares/auth');

router.get('/professor/assignments', ensureProfessor, professorAssignmentsController.index);
router.get('/professor/assignments/:id', ensureProfessor, professorAssignmentsController.show);

router.get(
    '/professor/assignments/:id/grades',
    ensureProfessor,
    professorAssignmentsController.getGradesForm
);

router.post(
    '/professor/assignments/:id/grades',
    ensureProfessor,
    professorAssignmentsController.saveGrades
);

module.exports = router;