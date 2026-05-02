const { ensureAdmin } = require('./auth');
const {
    attachCurrentAdmin,
    ensureAdminRole,
    ensureAdminScope,
    buildAdminScopedWhere,
    isGlobalAdmin,
    canAccessScope,
    resolveCurrentAdmin,
} = require('./permissions');

module.exports = {
    ensureAdmin,
    attachCurrentAdmin,
    ensureAdminRole,
    ensureAdminScope,
    buildAdminScopedWhere,
    isGlobalAdmin,
    canAccessScope,
    resolveCurrentAdmin,
};