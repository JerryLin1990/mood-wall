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

// Root route - Place BEFORE static middleware to ensure it takes precedence
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'moodwall.html'));
});

// New Route: Serve Env Configuration to Frontend
app.get('/env-config.js', (req, res) => {
    const config = {
        MAX_CARDS: MAX_CARDS,
        MAX_IMAGE_SIZE_KB: process.env.MAX_IMAGE_SIZE_KB || 100, // Send raw KB value
        // Debugging: Expose ports
        PORT: process.env.PORT,
        WEB_PORT: process.env.WEB_PORT,
        EXPECTED_PORT: 8080
    };
    res.set('Content-Type', 'application/javascript');
    res.send(`window.ENV = ${JSON.stringify(config)};`);
});

// Middleware
app.use(cors());

// Security: Block access to hidden files and sensitive source code
app.use((req, res, next) => {
    if (req.path.startsWith('/.') || // Block .env, .git, etc.
        req.path.includes('app.js') ||
        req.path.includes('package.json') ||
        req.path.includes('package-lock.json')) {
        return res.status(403).send('Forbidden');
    }
    next();
});
app.use(express.json({ limit: '50mb' })); // Increase limit for images
app.use(express.static('.')); // Serve static files

// Google Sheets Config
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SA_CLIENT_EMAIL = process.env.GOOGLE_SA_CLIENT_EMAIL;
const GOOGLE_SA_PRIVATE_KEY = process.env.GOOGLE_SA_PRIVATE_KEY;

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Columns definition
const COLUMNS = ['id', 'text', 'mood', 'style', 'header', 'part1', 'part2', 'part3', 'x', 'y', 'r', 'created_at'];
const SHEET_NAME = 'cards'; // User needs to create this sheet
const RANGE = `${SHEET_NAME}!A:L`; // A to L covers all columns

// Auth Client
const getAuthClient = () => {
    if (!GOOGLE_SA_PRIVATE_KEY) return null; // Handle missing env safely
    return new google.auth.JWT(
        GOOGLE_SA_CLIENT_EMAIL,
        null,
        GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n'),
        SCOPES
    );
};

const authClient = getAuthClient();
const sheets = authClient ? google.sheets({ version: 'v4', auth: authClient }) : null;

// Helper: Get all rows
async function getRows() {
    if (!sheets) return [];
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: RANGE,
    });
    const rows = response.data.values || [];
    if (rows.length === 0) return [];

    const headers = rows[0];
    const data = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index];
        });
        // Reconstruct parts array
        if (obj.part1 || obj.part2 || obj.part3) {
            obj.parts = [obj.part1, obj.part2, obj.part3].filter(p => p);
        }
        return obj;
    });
    return data;
}

// Routes

// GET /api/cards
app.get('/api/cards', async (req, res) => {
    try {
        const cards = await getRows();
        res.json(cards);
    } catch (error) {
        console.error('Error fetching cards:', error);
        res.status(500).json({ error: 'Failed to fetch cards' });
    }
});

// POST /api/cards
app.post('/api/cards', async (req, res) => {
    try {
        // Backend Limit Check 1: Max Cards
        const currentCards = await getRows();
        if (currentCards.length >= MAX_CARDS) {
            return res.status(400).json({ error: `Card limit reached (${MAX_CARDS})` });
        }

        const card = req.body;
        const parts = card.parts || [];

        // Backend Limit Check 2: Max Image Size (approximate)
        // We only check if parts exist.
        // Base64 size ~= size * 1.33. 
        // We calculate total string length of parts.
        const totalBase64Length = parts.join('').length;
        // Estimated bytes = length * 0.75
        const estimatedBytes = totalBase64Length * 0.75;

        // Allow a small buffer (e.g., 10%) for variation or header overhead
        if (estimatedBytes > MAX_IMAGE_SIZE_BYTES * 1.1) {
            return res.status(400).json({ error: `Image too large. Max allowed is ${MAX_IMAGE_SIZE_BYTES / 1024}KB` });
        }

        const row = [
            card.id,
            card.id,
            // Security: Sanitize text to prevent CSV Injection (Formula Injection)
            (card.text && /^[\=\+\-\@]/.test(card.text)) ? "'" + card.text : (card.text || ''),
            card.mood,
            card.style,
            card.header || '',
            parts[0] || '',
            parts[1] || '',
            parts[2] || '',
            card.x,
            card.y,
            card.r,
            new Date().toISOString()
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: RANGE,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [row]
            }
        });

        res.status(201).json({ message: 'Card added', card });
    } catch (error) {
        console.error('Error adding card:', error);
        res.status(500).json({ error: 'Failed to add card' });
    }
});

// DELETE /api/cards/:id
app.delete('/api/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: RANGE,
        });
        const rows = response.data.values || [];
        const rowIndex = rows.findIndex(row => row[0] === id); // Assuming ID is first column

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Card not found' });
        }

        // Delete row (using batchUpdate)
        // rowIndex is 0-based relative to the range, but sheet rows are 0-based absolute.
        // If range is 'cards!A:L', row 0 is header.
        // So actual sheet row index is rowIndex.

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: await getSheetId(SHEET_NAME),
                            dimension: 'ROWS',
                            startIndex: rowIndex,
                            endIndex: rowIndex + 1
                        }
                    }
                }]
            }
        });

        res.json({ message: 'Card deleted' });
    } catch (error) {
        console.error('Error deleting card:', error);
        res.status(500).json({ error: 'Failed to delete card' });
    }
});

// PATCH /api/cards/:id (Update position)
app.patch('/api/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { x, y, r } = req.body;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: RANGE,
        });
        const rows = response.data.values || [];
        const rowIndex = rows.findIndex(row => row[0] === id);

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Card not found' });
        }

        // Update x, y, r columns (Indices 8, 9, 10 based on COLUMNS array)
        // We need to update specific cells.
        // A1 notation: cards!I{row}:K{row} (I=9, J=10, K=11) -> Indices 8, 9, 10

        const sheetRow = rowIndex + 1; // 1-based for A1 notation

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!I${sheetRow}:K${sheetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[x, y, r]]
            }
        });

        res.json({ message: 'Card updated' });
    } catch (error) {
        console.error('Error updating card:', error);
        res.status(500).json({ error: 'Failed to update card' });
    }
});

// Helper: Get Sheet ID by Name
async function getSheetId(sheetName) {
    const response = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
    });
    const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : 0;
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`env.PORT: ${process.env.PORT}`);
    console.log(`env.WEB_PORT: ${process.env.WEB_PORT}`);
    console.log(`MAX_CARDS: ${MAX_CARDS}`);
    console.log(`MAX_IMAGE_SIZE: ${MAX_IMAGE_SIZE_BYTES / 1024} KB`);
});
