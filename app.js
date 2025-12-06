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
app.use(express.json({ limit: '5mb' })); // Reduced limit to save memory (client sends ~150KB)
app.use(express.static('.')); // Serve static files

// ... (Rest of file) ...

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`env.PORT: ${process.env.PORT}`);
    console.log(`env.WEB_PORT: ${process.env.WEB_PORT}`);
    console.log(`MAX_CARDS: ${MAX_CARDS}`);
    console.log(`MAX_IMAGE_SIZE: ${MAX_IMAGE_SIZE_BYTES / 1024} KB`);

    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`Initial Memory Usage: ${Math.round(used * 100) / 100} MB`);
});
