// src/middlewares/sessionConfig.js
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');

const MySQLStore = MySQLStoreFactory(session);

const isProduction = process.env.NODE_ENV === 'production';
const baseSecret = process.env.SESSION_SECRET || 'coresystem_secret';

function minutesToMs(minutes) {
    const parsed = Number(minutes);
    const safeMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;

    return 1000 * 60 * safeMinutes;
}

const idleMinutes = Number(process.env.SESSION_IDLE_MINUTES || 60);
const sessionMaxAgeMs = minutesToMs(idleMinutes);

function parseDatabaseUrl(databaseUrl) {
    if (!databaseUrl) return {};

    try {
        const parsed = new URL(databaseUrl);

        return {
            host: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : 3306,
            user: decodeURIComponent(parsed.username || ''),
            password: decodeURIComponent(parsed.password || ''),
            database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined,
        };
    } catch (error) {
        console.warn('DATABASE_URL invalide pour le session store MySQL.');
        return {};
    }
}

function buildMysqlSessionOptions() {
    const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);

    return {
        host: process.env.DATABASE_HOST || fromUrl.host || 'localhost',
        port: Number(process.env.DATABASE_PORT || fromUrl.port || 3306),
        user: process.env.DATABASE_USER || fromUrl.user || 'root',
        password:
            process.env.DATABASE_PASSWORD !== undefined
                ? process.env.DATABASE_PASSWORD
                : fromUrl.password || '',
        database:
            process.env.SESSION_DATABASE_NAME ||
            process.env.DATABASE_NAME ||
            fromUrl.database ||
            'core_system',

        createDatabaseTable: true,
        clearExpired: true,
        checkExpirationInterval: 1000 * 60 * 15,
        expiration: sessionMaxAgeMs,

        schema: {
            tableName: 'CoreSystemSessions',
            columnNames: {
                session_id: 'session_id',
                expires: 'expires',
                data: 'data',
            },
        },
    };
}

const sessionStore = new MySQLStore(buildMysqlSessionOptions());

function buildPortalSession({ name, secretSuffix }) {
    return session({
        name,
        secret: `${baseSecret}_${secretSuffix}`,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            secure: isProduction,
            httpOnly: true,
            sameSite: 'lax',
            maxAge: sessionMaxAgeMs,
        },
    });
}

const adminSession = buildPortalSession({
    name: 'coresystem.admin.sid',
    secretSuffix: 'admin',
});

const professorSession = buildPortalSession({
    name: 'coresystem.professor.sid',
    secretSuffix: 'professor',
});

const studentSession = buildPortalSession({
    name: 'coresystem.student.sid',
    secretSuffix: 'student',
});

module.exports = {
    adminSession,
    professorSession,
    studentSession,
    sessionMaxAgeMs,
    idleMinutes,
};