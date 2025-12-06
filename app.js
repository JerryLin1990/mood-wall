require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for images

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
    return new google.auth.JWT(
        GOOGLE_SA_CLIENT_EMAIL,
        null,
        GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n'),
        SCOPES
    );
};

const sheets = google.sheets({ version: 'v4', auth: getAuthClient() });

// Helper: Get all rows
async function getRows() {
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
        const card = req.body;
        const parts = card.parts || [];

        const row = [
            card.id,
            card.text || '',
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
});
