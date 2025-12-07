require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Env Vars for Limits
const MAX_CARDS = process.env.MAX_CARDS ? parseInt(process.env.MAX_CARDS) : 7;
// 100KB default if not set
const MAX_IMAGE_SIZE_BYTES = (process.env.MAX_IMAGE_SIZE_KB ? parseInt(process.env.MAX_IMAGE_SIZE_KB) : 100) * 1024;

// --- Google Sheets Configuration ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_SA_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_SA_PRIVATE_KEY ? process.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n') : null;

let sheets;

// Diagnosis Log for Deployment
console.log('--- Google Sheets Config Check ---');
console.log('SHEET_ID:', SHEET_ID ? 'Set' : 'MISSING');
console.log('CLIENT_EMAIL:', GOOGLE_CLIENT_EMAIL ? 'Set' : 'MISSING');
console.log('PRIVATE_KEY:', GOOGLE_PRIVATE_KEY ? 'Set' : 'MISSING');

if (SHEET_ID && GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: GOOGLE_CLIENT_EMAIL,
                private_key: GOOGLE_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Google Sheets Client Initialized.');
    } catch (authError) {
        console.error('Google Auth Init Failed:', authError.message);
    }
} else {
    console.error('CRITICAL ERROR: Google Sheets credentials incomplete. App will return 503 for write operations.');
}

// --- Google Sheets Helpers (Dynamic Sheet Name) ---

// Cache the sheet title to avoid fetching metadata on every request
let cachedSheetTitle = null;
let cachedSheetId = 0; // Default to 0 (first sheet)

async function getSheetInfo() {
    if (!sheets) throw new Error('Google Sheets not configured');
    if (cachedSheetTitle) return { title: cachedSheetTitle, sheetId: cachedSheetId };

    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const sheet = meta.data.sheets[0]; // Use the first sheet
        cachedSheetTitle = sheet.properties.title;
        cachedSheetId = sheet.properties.sheetId;
        console.log(`Using Sheet: "${cachedSheetTitle}" (ID: ${cachedSheetId})`);
        return { title: cachedSheetTitle, sheetId: cachedSheetId };
    } catch (err) {
        console.error('Failed to get spreadsheet metadata:', err);
        throw err;
    }
}

// --- Data Helpers ---
function rowToCard(row) {
    // Columns: [ID, Text, Mood, Style, Header, Part1, Part2, Part3, X, Y, R]
    if (!row || row.length === 0) return null;
    if (row[0] === 'id' || row[0] === 'ID') return null; // Skip header

    return {
        id: row[0],
        text: row[1] || '',
        mood: parseInt(row[2]) || 1,
        style: row[3] || 'polaroid',
        header: row[4] || '',
        parts: [row[5], row[6], row[7]].filter(p => p && p.length > 0),
        x: parseFloat(row[8]) || 0,
        y: parseFloat(row[9]) || 0,
        r: parseFloat(row[10]) || 0,
        createdAt: row[11] || null
    };
}

function cardToRow(card) {
    const p = card.parts || [];
    return [
        card.id,
        card.text,
        card.mood,
        card.style,
        card.header,
        p[0] || '',
        p[1] || '',
        p[2] || '',
        card.x,
        card.y,
        card.r,
        card.createdAt || ''
    ];
}

async function getSheetData() {
    if (!sheets) return [];
    try {
        const { title } = await getSheetInfo();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${title}!A:L`, // Dynamic range
        });
        return response.data.values || [];
    } catch (err) {
        console.error('Google Sheets Read Error:', err);
        return []; // Return empty array on error to keep app running
    }
}

// --- Routes ---

// Root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'moodwall.html'));
});

// Env Config for Frontend
app.get('/env-config.js', (req, res) => {
    const config = {
        MAX_CARDS: MAX_CARDS,
        MAX_IMAGE_SIZE_KB: process.env.MAX_IMAGE_SIZE_KB || 100,
        // Removed internal port details for security
    };
    res.set('Content-Type', 'application/javascript');
    res.send(`window.ENV = ${JSON.stringify(config)};`);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Security
app.use((req, res, next) => {
    const forbiddenFiles = ['app.js', 'package.json', 'package-lock.json', '.env', '.gitignore', 'readme.md'];
    const lowerPath = req.path.toLowerCase();
    const fileName = path.basename(lowerPath);

    // Block hidden files/directories (starting with dot)
    if (lowerPath.includes('/.') || fileName.startsWith('.')) {
        return res.status(403).send('Forbidden');
    }

    // Block sensitive files by name (exact match or case-insensitive)
    if (forbiddenFiles.includes(fileName)) {
        return res.status(403).send('Forbidden');
    }

    next();
});

// Static Files
app.use(express.static('.'));

// API Routes
app.get('/api/cards', async (req, res) => {
    try {
        const rows = await getSheetData();
        const cards = rows.map(rowToCard).filter(c => c !== null);
        res.json(cards);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

app.post('/api/cards', async (req, res) => {
    if (!sheets) return res.status(503).json({ error: 'Storage unavailable' });
    try {
        const { title } = await getSheetInfo();
        const newCard = req.body;

        // 1. Basic Content Validation
        if (!newCard || typeof newCard !== 'object') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        // Limit text length to prevent abuse
        if (newCard.text && newCard.text.length > 500) {
            return res.status(400).json({ error: 'Text too long' });
        }
        // Ensure x, y, r are numbers to prevent injection/formatting issues
        newCard.x = Number(newCard.x) || 0;
        newCard.y = Number(newCard.y) || 0;
        newCard.r = Number(newCard.r) || 0;

        // 2. Enforce Max Cards Limit
        const allRows = await getSheetData();
        // Count only valid card rows
        const currentCardCount = allRows.map(rowToCard).filter(c => c !== null).length;

        if (currentCardCount >= MAX_CARDS) {
            return res.status(400).json({ error: `Card limit reached (${MAX_CARDS})` });
        }

        const row = cardToRow(newCard);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: `${title}!A:L`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [row] },
        });
        res.status(201).json(newCard);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save' });
    }
});

app.patch('/api/cards/:id', async (req, res) => {
    if (!sheets) return res.status(503).json({ error: 'Storage unavailable' });
    try {
        const { title } = await getSheetInfo();
        const { id } = req.params;
        const updates = req.body;

        // Fetch all data to find the row index
        const allRows = await getSheetData();
        const rowIndex = allRows.findIndex(row => row[0] === id);

        if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });

        const existingCard = rowToCard(allRows[rowIndex]);
        const updatedCard = { ...existingCard, ...updates };
        const updatedRow = cardToRow(updatedCard);

        const sheetRow = rowIndex + 1; // 1-indexed

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${title}!A${sheetRow}:L${sheetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [updatedRow] },
        });
        res.json(updatedCard);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update' });
    }
});

app.delete('/api/cards/:id', async (req, res) => {
    if (!sheets) return res.status(503).json({ error: 'Storage unavailable' });
    try {
        const { sheetId } = await getSheetInfo(); // Need numeric SheetID for batchUpdate
        const { id } = req.params;

        const allRows = await getSheetData();
        const rowIndex = allRows.findIndex(row => row[0] === id);

        if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            resource: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: sheetId,
                            dimension: 'ROWS',
                            startIndex: rowIndex,     // 0-indexed inclusive
                            endIndex: rowIndex + 1    // exclusive
                        }
                    }
                }]
            }
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (sheets) console.log('Connected to Google Sheets');
});
