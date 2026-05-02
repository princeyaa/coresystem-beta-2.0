// src/middlewares/csrf.js
const crypto = require('crypto');
const { setFlash } = require('../utils/flash');

const CSRF_FIELD_NAME = '_csrf';

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function ensureCsrfToken(req) {
    if (!req.session) {
        return null;
    }

    if (!req.session.csrfToken) {
        req.session.csrfToken = generateToken();
    }

    return req.session.csrfToken;
}

function attachCsrfToken(req, res, next) {
    const token = ensureCsrfToken(req);

    res.locals.csrfToken = token;
    res.locals.csrfFieldName = CSRF_FIELD_NAME;

    next();
}

function isUnsafeMethod(method) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
}

function verifyCsrfToken(req, res, next) {
    if (!isUnsafeMethod(req.method)) {
        return next();
    }

    const sessionToken = req.session ? req.session.csrfToken : null;
    const submittedToken =
        req.body && typeof req.body[CSRF_FIELD_NAME] === 'string'
            ? req.body[CSRF_FIELD_NAME]
            : null;

    if (!sessionToken || !submittedToken || sessionToken !== submittedToken) {
        setFlash(req, 'error', 'Session de formulaire invalide. Veuillez réessayer.');

        const fallback =
            req.get('Referrer') ||
            req.get('Referer') ||
            '/';

        return res.redirect(fallback);
    }

    return next();
}

function csrfProtection(req, res, next) {
    attachCsrfToken(req, res, () => {
        verifyCsrfToken(req, res, next);
    });
}

module.exports = {
    CSRF_FIELD_NAME,
    attachCsrfToken,
    verifyCsrfToken,
    csrfProtection,
};