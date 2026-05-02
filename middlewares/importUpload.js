const multer = require('multer');

const MAX_IMPORT_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 Mo

const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_IMPORT_FILE_SIZE_BYTES,
    },
});

module.exports = {
    importUpload,
    MAX_IMPORT_FILE_SIZE_BYTES,
};