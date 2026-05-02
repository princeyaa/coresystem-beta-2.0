require('dotenv').config();

const express = require('express');
const path = require('path');

const { attachCsrfToken, verifyCsrfToken } = require('./src/middlewares/csrf');
const errorHandler = require('./src/middlewares/errorHandler');
const { getAndClearFlash } = require('./src/utils/flash');
const helpers = require('./src/utils/viewHelpers');
const { getCurrentActorType } = require('./src/middlewares/auth');
const {
  adminSession,
  professorSession,
  studentSession,
} = require('./src/middlewares/sessionConfig');

const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Config EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Middlewares de base
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src', 'public')));

// Nettoyage de l’ancien cookie global.
// Important après la migration vers 3 sessions séparées.
app.use((req, res, next) => {
  res.clearCookie('coresystem.sid');
  next();
});

function attachViewLocals(req, res, next) {
  const currentActorType = getCurrentActorType(req.session);
  res.locals.csrfToken = req.session ? req.session.csrfToken : null;
  res.locals.csrfFieldName = '_csrf';
  res.locals.session = req.session;
  res.locals.flash = getAndClearFlash(req);
  res.locals.currentPath = req.path;
  res.locals.helpers = helpers;
  res.locals.currentActorType = currentActorType;
  res.locals.isStudentAuthenticated = currentActorType === 'student';
  res.locals.isAdminAuthenticated = currentActorType === 'admin';
  res.locals.isProfessorAuthenticated = currentActorType === 'professor';

  next();
}

function captureSession(key) {
  return (req, res, next) => {
    req[key] = req.session;
    next();
  };
}
function protectPostRequests({ excludedPaths = [] } = {}) {
  return (req, res, next) => {
    const isPost = String(req.method).toUpperCase() === 'POST';

    if (!isPost) {
      return next();
    }

    if (excludedPaths.includes(req.path)) {
      return next();
    }

    return verifyCsrfToken(req, res, next);
  };
}

// Routes étudiant
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const scheduleRoutes = require('./src/routes/schedule');
const notesRoutes = require('./src/routes/notes');
const announcementsRoutes = require('./src/routes/announcements');
const requestsRoutes = require('./src/routes/requests');
const coursesRoutes = require('./src/routes/courses');

// Routes admin
const adminAuthRoutes = require('./src/routes/adminAuth');
const adminDashboardRoutes = require('./src/routes/adminDashboard');
const adminProgramsRoutes = require('./src/routes/adminPrograms');
const adminCoursesRoutes = require('./src/routes/adminCourses');
const adminSchedulesRoutes = require('./src/routes/adminSchedules');
const adminGradesRoutes = require('./src/routes/adminGrades');
const adminAnnouncementsRoutes = require('./src/routes/adminAnnouncements');
const adminRequestsRoutes = require('./src/routes/adminRequests');
const adminCampusesRoutes = require('./src/routes/adminCampuses');
const adminDepartmentsRoutes = require('./src/routes/adminDepartments');
const adminClassesRoutes = require('./src/routes/adminClasses');
const adminProfessorsRoutes = require('./src/routes/adminProfessors');
const adminTeachingAssignmentsRoutes = require('./src/routes/adminTeachingAssignments');
const adminUsersRoutes = require('./src/routes/adminUsers');
const adminStudentsRoutes = require('./src/routes/adminStudents');
const adminSearchRoutes = require('./src/routes/adminSearch');

// Routes professeur
const professorAuthRoutes = require('./src/routes/professorAuth');
const professorDashboardRoutes = require('./src/routes/professorDashboard');
const professorAssignmentsRoutes = require('./src/routes/professorAssignments');

/// Session admin uniquement pour /admin/*
app.use('/admin', adminSession, attachCsrfToken, attachViewLocals);

// Protection CSRF globale admin.
// Les imports preview sont exclus ici parce qu'ils utilisent multer.
// Leur CSRF est vérifié directement dans les routes, après importUpload.single().
app.use('/admin', protectPostRequests({
  excludedPaths: [
    '/students/import/preview',
    '/grades/import/preview',
  ],
}));

// Session professeur uniquement pour /professor/*
app.use('/professor', professorSession, attachCsrfToken, attachViewLocals);
app.use('/professor', protectPostRequests());

// Routes admin
app.use(adminSearchRoutes);
app.use(adminAuthRoutes);
app.use(adminDashboardRoutes);
app.use(adminProgramsRoutes);
app.use(adminCoursesRoutes);
app.use(adminSchedulesRoutes);
app.use(adminGradesRoutes);
app.use(adminAnnouncementsRoutes);
app.use(adminRequestsRoutes);
app.use(adminCampusesRoutes);
app.use(adminDepartmentsRoutes);
app.use(adminClassesRoutes);
app.use(adminProfessorsRoutes);
app.use(adminTeachingAssignmentsRoutes);
app.use(adminUsersRoutes);
app.use(adminStudentsRoutes);

// Routes professeur
app.use(professorAuthRoutes);
app.use(professorDashboardRoutes);
app.use(professorAssignmentsRoutes);

// Session étudiant pour les routes étudiantes restantes
app.use(studentSession, attachCsrfToken, attachViewLocals);
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/professor')) {
    return next();
  }

  return protectPostRequests()(req, res, next);
});

// Routes étudiant
app.use(authRoutes);
app.use(dashboardRoutes);
app.use(scheduleRoutes);
app.use(notesRoutes);
app.use(announcementsRoutes);
app.use(requestsRoutes);
app.use(coursesRoutes);

// Route accueil.
// On lit les 3 cookies séparément sans les mélanger.
app.get(
  '/',
  adminSession,
  captureSession('adminPortalSession'),
  professorSession,
  captureSession('professorPortalSession'),
  studentSession,
  captureSession('studentPortalSession'),
  (req, res) => {
    if (req.adminPortalSession && req.adminPortalSession.adminId) {
      return res.redirect('/admin/dashboard');
    }

    if (req.professorPortalSession && req.professorPortalSession.professorId) {
      return res.redirect('/professor/dashboard');
    }

    if (req.studentPortalSession && req.studentPortalSession.userId) {
      return res.redirect('/dashboard');
    }

    return res.redirect('/login');
  }
);

// 404
app.use((req, res) => {
  res.status(404).send('Page non trouvée');
});

// Middleware global d’erreur
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});