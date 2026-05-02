require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
    console.log('-----------------------------------');
    console.log('Seed CoreSystem V2 en cours...');
    console.log('-----------------------------------');

    console.log('Suppression des anciennes données...');

    await prisma.teachingAssignment.deleteMany();
    await prisma.grade.deleteMany();
    await prisma.schedule.deleteMany();
    await prisma.request.deleteMany();
    await prisma.announcement.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.professor.deleteMany();
    await prisma.academicClass.deleteMany();
    await prisma.course.deleteMany();
    await prisma.program.deleteMany();
    await prisma.student.deleteMany();
    await prisma.adminUser.deleteMany();
    await prisma.department.deleteMany();
    await prisma.campus.deleteMany();

    console.log('Création des campus...');

    const campusBadalabougou = await prisma.campus.create({
        data: {
            code: 'BDL',
            nom: 'Badalabougou',
            adresse: 'Badalabougou, Bamako',
        },
    });

    const campusTorokorobougou = await prisma.campus.create({
        data: {
            code: 'TRK',
            nom: 'Torokoubougou',
            adresse: 'Torokoubougou, Bamako',
        },
    });

    console.log('Création des départements...');

    const deptInformatique = await prisma.department.create({
        data: {
            code: 'INFO-BDL',
            nom: 'Informatique',
            campusId: campusBadalabougou.id,
        },
    });

    const deptGestion = await prisma.department.create({
        data: {
            code: 'GEST-TRK',
            nom: 'Gestion',
            campusId: campusTorokorobougou.id,
        },
    });

    console.log('Création des programmes...');

    const programInfoL2 = await prisma.program.create({
        data: {
            filiere: 'Informatique',
            niveau: 'L2',
            faculte: 'FSEG',
            regime: 'annuel',
        },
    });

    const programGestionL1 = await prisma.program.create({
        data: {
            filiere: 'Gestion',
            niveau: 'L1',
            faculte: 'FSEG',
            regime: 'annuel',
        },
    });

    console.log('Création des cours...');

    const courseAlgo = await prisma.course.create({
        data: {
            code: 'INFO201',
            nom: 'Algorithmique avancée',
            semestre: 'S1',
            volumeHoraire: 45,
            credits: 6,
            coefficient: 1.5,
            enseignant: 'Dr. Traoré',
            programId: programInfoL2.id,
        },
    });

    const courseBD = await prisma.course.create({
        data: {
            code: 'INFO202',
            nom: 'Bases de données',
            semestre: 'S1',
            volumeHoraire: 30,
            credits: 4,
            coefficient: 1.0,
            enseignant: 'Pr. Diallo',
            programId: programInfoL2.id,
        },
    });

    const courseCompta = await prisma.course.create({
        data: {
            code: 'GEST101',
            nom: 'Comptabilité générale',
            semestre: 'S1',
            volumeHoraire: 30,
            credits: 4,
            coefficient: 1.0,
            enseignant: 'Mme Coulibaly',
            programId: programGestionL1.id,
        },
    });

    const courseManagement = await prisma.course.create({
        data: {
            code: 'GEST102',
            nom: 'Introduction au management',
            semestre: 'S1',
            volumeHoraire: 30,
            credits: 4,
            coefficient: 1.0,
            enseignant: 'M. Konaté',
            programId: programGestionL1.id,
        },
    });

    console.log('Création des classes académiques...');

    const classInfoL2A = await prisma.academicClass.create({
        data: {
            code: 'INF-L2A-BDL',
            nom: 'INF L2 A',
            academicYear: '2025-2026',
            campusId: campusBadalabougou.id,
            departmentId: deptInformatique.id,
            programId: programInfoL2.id,
        },
    });

    const classGestionL1A = await prisma.academicClass.create({
        data: {
            code: 'GEST-L1A-TRK',
            nom: 'GEST L1 A',
            academicYear: '2025-2026',
            campusId: campusTorokorobougou.id,
            departmentId: deptGestion.id,
            programId: programGestionL1.id,
        },
    });

    console.log('Création des créneaux...');

    await prisma.schedule.createMany({
        data: [
            {
                jour: 'LUNDI',
                heureDebut: '08:00',
                heureFin: '10:00',
                salle: 'Salle A101',
                statut: 'NORMAL',
                courseId: courseAlgo.id,
            },
            {
                jour: 'MARDI',
                heureDebut: '10:00',
                heureFin: '12:00',
                salle: 'Salle B202',
                statut: 'NORMAL',
                courseId: courseBD.id,
            },
            {
                jour: 'MERCREDI',
                heureDebut: '09:00',
                heureFin: '11:00',
                salle: 'Salle G103',
                statut: 'NORMAL',
                courseId: courseCompta.id,
            },
            {
                jour: 'JEUDI',
                heureDebut: '11:00',
                heureFin: '13:00',
                salle: 'Salle G204',
                statut: 'NORMAL',
                courseId: courseManagement.id,
            },
        ],
    });

    console.log('Création des étudiants...');

    const hashedStudentPassword = await bcrypt.hash('password123', 10);

    const studentFatou = await prisma.student.create({
        data: {
            matricule: '2021001',
            nom: 'Keita',
            prenom: 'Fatou',
            email: 'fatou.keita@example.com',
            telephone: '620000000',
            password: hashedStudentPassword,
        },
    });

    const studentBoubacar = await prisma.student.create({
        data: {
            matricule: '2021002',
            nom: 'Coulibaly',
            prenom: 'Boubacar',
            email: 'boubacar.coulibaly@example.com',
            telephone: '630000000',
            password: hashedStudentPassword,
        },
    });

    console.log('Création des inscriptions...');

    await prisma.enrollment.create({
        data: {
            academicYear: '2025-2026',
            studentId: studentFatou.id,
            programId: programInfoL2.id,
            classId: classInfoL2A.id,
        },
    });

    await prisma.enrollment.create({
        data: {
            academicYear: '2025-2026',
            studentId: studentBoubacar.id,
            programId: programGestionL1.id,
            classId: classGestionL1A.id,
        },
    });

    console.log('Création des administrateurs...');

    const hashedAdminPassword = await bcrypt.hash('admin123', 10);

    const superAdmin = await prisma.adminUser.create({
        data: {
            nom: 'ONGOIBA',
            prenom: 'Amadou',
            email: 'prince@gmail.com',
            password: hashedAdminPassword,
            role: 'SUPER_ADMIN',
        },
    });

    await prisma.adminUser.create({
        data: {
            nom: 'Admin',
            prenom: 'Badalabougou',
            email: 'admin.bdl@gmail.com',
            password: hashedAdminPassword,
            role: 'ADMIN_CAMPUS',
            campusId: campusBadalabougou.id,
            departmentId: null,
        },
    });

    await prisma.adminUser.create({
        data: {
            nom: 'Admin',
            prenom: 'Torokoubougou',
            email: 'admin.trk@gmail.com',
            password: hashedAdminPassword,
            role: 'ADMIN_CAMPUS',
            campusId: campusTorokorobougou.id,
            departmentId: null,
        },
    });

    console.log('Création des professeurs...');

    const hashedProfessorPassword = await bcrypt.hash('profTemp123', 10);

    const profInfo = await prisma.professor.create({
        data: {
            nom: 'Traore',
            prenom: 'Moussa',
            email: 'prof.info@example.com',
            telephone: '650000001',
            password: hashedProfessorPassword,
            campusId: campusBadalabougou.id,
            departmentId: deptInformatique.id,
        },
    });

    const profGestion = await prisma.professor.create({
        data: {
            nom: 'Konate',
            prenom: 'Fatoumata',
            email: 'prof.gestion@example.com',
            telephone: '650000002',
            password: hashedProfessorPassword,
            campusId: campusTorokorobougou.id,
            departmentId: deptGestion.id,
        },
    });

    console.log('Création des affectations d’enseignement...');

    await prisma.teachingAssignment.createMany({
        data: [
            {
                academicYear: '2025-2026',
                professorId: profInfo.id,
                courseId: courseAlgo.id,
                classId: classInfoL2A.id,
            },
            {
                academicYear: '2025-2026',
                professorId: profInfo.id,
                courseId: courseBD.id,
                classId: classInfoL2A.id,
            },
            {
                academicYear: '2025-2026',
                professorId: profGestion.id,
                courseId: courseCompta.id,
                classId: classGestionL1A.id,
            },
            {
                academicYear: '2025-2026',
                professorId: profGestion.id,
                courseId: courseManagement.id,
                classId: classGestionL1A.id,
            },
        ],
    });

    console.log('Création des notes...');

    await prisma.grade.createMany({
        data: [
            {
                typeEvaluation: 'CC',
                valeur: 14.5,
                published: true,
                studentId: studentFatou.id,
                courseId: courseAlgo.id,
            },
            {
                typeEvaluation: 'PARTIEL',
                valeur: 12.0,
                published: true,
                studentId: studentFatou.id,
                courseId: courseBD.id,
            },
            {
                typeEvaluation: 'CC',
                valeur: 13.0,
                published: true,
                studentId: studentBoubacar.id,
                courseId: courseCompta.id,
            },
            {
                typeEvaluation: 'PARTIEL',
                valeur: 11.5,
                published: false,
                studentId: studentBoubacar.id,
                courseId: courseManagement.id,
            },
        ],
    });

    console.log('Création des annonces...');

    await prisma.announcement.create({
        data: {
            titre: 'Rentrée universitaire',
            contenu:
                'La rentrée universitaire aura lieu le 15 octobre. Veuillez consulter votre emploi du temps.',
            priorite: 'NORMALE',
            expiresAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
            authorId: superAdmin.id,
            programId: programInfoL2.id,
        },
    });

    await prisma.announcement.create({
        data: {
            titre: 'Réunion pédagogique',
            contenu:
                'Une réunion pédagogique est prévue pour les étudiants du site de Torokoubougou.',
            priorite: 'IMPORTANTE',
            expiresAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
            authorId: superAdmin.id,
            programId: programGestionL1.id,
        },
    });

    console.log('Création des demandes...');

    await prisma.request.create({
        data: {
            typeDemande: 'ATTESTATION_INSCRIPTION',
            statut: 'SOUMISE',
            studentId: studentFatou.id,
            motif: 'Besoin pour dépôt de dossier de stage.',
        },
    });

    await prisma.request.create({
        data: {
            typeDemande: 'RELEVE_DE_NOTES',
            statut: 'EN_TRAITEMENT',
            studentId: studentBoubacar.id,
            motif: 'Demande de relevé provisoire.',
            treatedById: superAdmin.id,
            treatedAt: new Date(),
            commentaire: 'Demande en cours de traitement par la scolarité.',
        },
    });

    console.log('-----------------------------------');
    console.log('Création terminée avec succès.');
    console.log('-----------------------------------');
    console.log('Étudiants :');
    console.log('- Matricule : 2021001 | Mot de passe : password123');
    console.log('- Matricule : 2021002 | Mot de passe : password123');
    console.log('-----------------------------------');
    console.log('Admins :');
    console.log('- Email : prince@gmail.com | Mot de passe : admin123 | Rôle : SUPER_ADMIN');
    console.log('- Email : admin.bdl@gmail.com | Mot de passe : admin123 | Rôle : ADMIN_CAMPUS');
    console.log('- Email : admin.trk@gmail.com | Mot de passe : admin123 | Rôle : ADMIN_CAMPUS');
    console.log('-----------------------------------');
    console.log('Professeurs :');
    console.log('- Email : prof.info@example.com | Mot de passe : profTemp123');
    console.log('- Email : prof.gestion@example.com | Mot de passe : profTemp123');
    console.log('-----------------------------------');
}

main()
    .catch((error) => {
        console.error('Erreur dans le seed :', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });