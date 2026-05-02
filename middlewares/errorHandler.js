const errorHandler = (err, req, res, next) => {
    console.error('Erreur globale non gérée :', err);

    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.statusCode || 500;
    const message =
        process.env.NODE_ENV === 'production'
            ? 'Erreur interne du serveur'
            : err.message || 'Erreur interne du serveur';

    if (req.originalUrl.startsWith('/api/')) {
        return res.status(statusCode).json({
            success: false,
            message,
        });
    }

    return res.status(statusCode).send(message);
};

module.exports = errorHandler;