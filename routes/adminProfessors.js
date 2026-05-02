const express = require('express');
const router = express.Router();

const adminProfessorController = require('../controllers/adminProfessorController');
const { ensureAdminRole } = require('../middlewares/permissions');

const canManageProfessors = ensureAdminRole(
    'SUPER_ADMIN',
    'ADMIN_CAMPUS'
);

router.get('/admin/professors', canManageProfessors, adminProfessorController.index);
router.get('/admin/professors/new', canManageProfessors, adminProfessorController.createForm);
router.post('/admin/professors', canManageProfessors, adminProfessorController.store);

router.get('/admin/professors/:id', canManageProfessors, adminProfessorController.show);
router.get('/admin/professors/:id/edit', canManageProfessors, adminProfessorController.editForm);
router.post('/admin/professors/:id', canManageProfessors, adminProfessorController.update);
router.post('/admin/professors/:id/toggle-active', canManageProfessors, adminProfessorController.toggleActive);
router.post('/admin/professors/:id/reset-password', canManageProfessors, adminProfessorController.resetPassword);
router.post('/admin/professors/:id/delete', canManageProfessors, adminProfessorController.destroy);

module.exports = router;