const express = require('express');
const router = express.Router();

const adminTeachingAssignmentController = require('../controllers/adminTeachingAssignmentController');
const { ensureAdminRole } = require('../middlewares/permissions');

const canManageAssignments = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

// Alias anciens liens GET
router.get('/admin/teaching-assignments', canManageAssignments, (req, res) => {
    return res.redirect('/admin/assignments');
});

router.get('/admin/teaching-assignments/new', canManageAssignments, (req, res) => {
    return res.redirect('/admin/assignments/new');
});

router.get('/admin/teaching-assignments/:id/edit', canManageAssignments, (req, res) => {
    return res.redirect(`/admin/assignments/${req.params.id}/edit`);
});

// Route officielle
router.get('/admin/assignments', canManageAssignments, adminTeachingAssignmentController.index);
router.get('/admin/assignments/new', canManageAssignments, adminTeachingAssignmentController.createForm);
router.post('/admin/assignments', canManageAssignments, adminTeachingAssignmentController.store);
router.get('/admin/assignments/:id/edit', canManageAssignments, adminTeachingAssignmentController.editForm);
router.post('/admin/assignments/:id', canManageAssignments, adminTeachingAssignmentController.update);
router.post('/admin/assignments/:id/delete', canManageAssignments, adminTeachingAssignmentController.destroy);

module.exports = router;