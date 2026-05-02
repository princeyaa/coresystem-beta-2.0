const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IMPORT_TEMP_DIR = path.join(os.tmpdir(), 'coresystem-imports');

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

async function ensureImportTempDir() {
    await fs.mkdir(IMPORT_TEMP_DIR, { recursive: true });
}

function buildTempFilePath(token, originalname) {
    const extension = path.extname(String(originalname || '')).toLowerCase() || '.tmp';
    return path.join(IMPORT_TEMP_DIR, `${token}${extension}`);
}

async function savePendingImportFile(file) {
    if (!file || !file.buffer || !file.originalname) {
        throw new Error('Aucun fichier importable à sauvegarder.');
    }

    await ensureImportTempDir();

    const token = crypto.randomUUID();
    const filePath = buildTempFilePath(token, file.originalname);

    await fs.writeFile(filePath, file.buffer);

    return {
        token,
        originalname: normalizeText(file.originalname),
        mimetype: normalizeText(file.mimetype),
        size: Number(file.size || file.buffer.length || 0),
    };
}

async function loadPendingImportFile(meta) {
    if (!meta || !meta.token || !meta.originalname) {
        throw new Error('Aucun fichier Excel en attente.');
    }

    await ensureImportTempDir();

    const filePath = buildTempFilePath(meta.token, meta.originalname);
    const buffer = await fs.readFile(filePath);

    return {
        originalname: meta.originalname,
        mimetype: meta.mimetype || '',
        size: meta.size || buffer.length,
        buffer,
    };
}

async function deletePendingImportFile(meta) {
    if (!meta || !meta.token || !meta.originalname) {
        return;
    }

    try {
        const filePath = buildTempFilePath(meta.token, meta.originalname);
        await fs.unlink(filePath);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return;
        }

        throw error;
    }
}

module.exports = {
    savePendingImportFile,
    loadPendingImportFile,
    deletePendingImportFile,
};