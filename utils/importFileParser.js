const path = require('path');
const ExcelJS = require('exceljs');

const ALLOWED_IMPORT_EXTENSIONS = ['.csv', '.xlsx'];

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function escapeCsvValue(value) {
    const text = String(value ?? '');
    if (/[",;\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function stripBom(text) {
    return String(text || '').replace(/^\uFEFF/, '');
}

function getExtension(filename = '') {
    return path.extname(String(filename || '')).toLowerCase();
}

function assertSupportedImportExtension(filename = '') {
    const extension = getExtension(filename);

    if (!ALLOWED_IMPORT_EXTENSIONS.includes(extension)) {
        throw new Error('Format non supporté. Utilisez un fichier .csv ou .xlsx.');
    }

    return extension;
}

async function csvBufferToText(buffer) {
    return stripBom(buffer.toString('utf8'));
}

async function loadWorkbookFromBuffer(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
}

function getWorkbookSheetNames(workbook) {
    return workbook.worksheets
        .map((worksheet) => normalizeText(worksheet.name))
        .filter(Boolean);
}

async function worksheetToCsvText(worksheet) {
    if (!worksheet) {
        throw new Error('Le fichier Excel ne contient aucune feuille exploitable.');
    }

    const maxColumnCount = Math.max(worksheet.columnCount || 0, 1);
    const lines = [];

    worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = [];

        for (let col = 1; col <= maxColumnCount; col += 1) {
            const cell = row.getCell(col);
            values.push(escapeCsvValue(normalizeText(cell.text)));
        }

        const joined = values.join(';');

        if (normalizeText(joined.replace(/;/g, ''))) {
            lines.push(joined);
        }
    });

    const text = lines.join('\n').trim();

    if (!text) {
        throw new Error('La feuille Excel sélectionnée est vide ou ne contient aucune ligne exploitable.');
    }

    return text;
}

function extractPastedCsvText(bodyText) {
    const text = stripBom(typeof bodyText === 'string' ? bodyText : '');
    return normalizeText(text) ? text : '';
}

async function inspectImportFile(file, selectedSheetName = '') {
    if (!file || !file.buffer || !file.originalname) {
        throw new Error('Aucun fichier importable reçu.');
    }

    const extension = assertSupportedImportExtension(file.originalname);

    if (extension === '.csv') {
        return {
            status: 'ready',
            csvText: await csvBufferToText(file.buffer),
            selectedSheetName: '',
            sheetNames: [],
            originalname: file.originalname,
            sourceType: 'csv_file',
        };
    }

    if (extension !== '.xlsx') {
        throw new Error('Format non supporté.');
    }

    const workbook = await loadWorkbookFromBuffer(file.buffer);
    const sheetNames = getWorkbookSheetNames(workbook);

    if (!sheetNames.length) {
        throw new Error('Le fichier Excel ne contient aucune feuille exploitable.');
    }

    const normalizedSelectedSheet = normalizeText(selectedSheetName);

    if (!normalizedSelectedSheet && sheetNames.length > 1) {
        return {
            status: 'sheet_selection_required',
            sheetNames,
            originalname: file.originalname,
            sourceType: 'xlsx_file',
        };
    }

    const targetSheetName = normalizedSelectedSheet || sheetNames[0];
    const worksheet = workbook.worksheets.find(
        (item) => normalizeText(item.name) === targetSheetName
    );

    if (!worksheet) {
        throw new Error('La feuille Excel sélectionnée est introuvable.');
    }

    return {
        status: 'ready',
        csvText: await worksheetToCsvText(worksheet),
        selectedSheetName: worksheet.name,
        sheetNames,
        originalname: file.originalname,
        sourceType: 'xlsx_file',
    };
}

module.exports = {
    ALLOWED_IMPORT_EXTENSIONS,
    extractPastedCsvText,
    inspectImportFile,
};