const setFlash = (req, type, message) => {
    req.session.flash = { type, message };
};

const getAndClearFlash = (req) => {
    const flash = req.session.flash || null;
    delete req.session.flash;
    return flash;
};

module.exports = {
    setFlash,
    getAndClearFlash,
};