
/**
 * Global Configuration (Default values, will be overwritten by window.ENV if available)
 */
const DEFAULT_MAX_CARDS = 7;
const DEFAULT_IMAGE_MAX_KB = 100;

// Use window.ENV or fallback to defaults
const MAX_CARDS = (window.ENV && window.ENV.MAX_CARDS) ? parseInt(window.ENV.MAX_CARDS) : DEFAULT_MAX_CARDS;
const TARGET_IMAGE_MAX_BYTES = ((window.ENV && window.ENV.MAX_IMAGE_SIZE_KB) ? parseInt(window.ENV.MAX_IMAGE_SIZE_KB) : DEFAULT_IMAGE_MAX_KB) * 1024;
const API_URL = '/api/cards';

// DOM Elements
const typedText = document.getElementById('typed-text');
const hiddenInput = document.getElementById('hidden-input');
const paperDiv = document.getElementById('paper');
const fileInput = document.getElementById('file-input');
const btnUpload = document.getElementById('btn-upload');
const printBtn = document.getElementById('print-btn');
const cardsLayer = document.getElementById('cards-layer');
const moodButtons = document.querySelectorAll('.mood-btn');
const styleSelect = document.getElementById('card-style');
const overlay = document.getElementById('overlay');
const typewriterContainer = document.querySelector('.typewriter-container');

// State
let currentMood = 3;
let currentStyle = 'polaroid';
let currentBase64Parts = null;

// Initialization
window.onload = () => {
    loadCards();
    focusInput();
    adjustLayout();
};
window.onresize = adjustLayout;

/**
 * Adjusts the layout based on window width
 */
function adjustLayout() {
    const w = window.innerWidth;
    let scale = 0.5;
    if (w < 420) {
        scale = ((w - 20) / 380) * 0.6;
    }
    typewriterContainer.style.transform = `translateX(-50%) scale(${scale})`;
}

/**
 * Focuses the hidden input for typing
 */
function focusInput() { hiddenInput.focus(); }
paperDiv.addEventListener('click', focusInput);

// Overlay click handler (close expanded cards)
overlay.addEventListener('click', () => {
    document.querySelectorAll('.card.expanded').forEach(c => c.classList.remove('expanded'));
    overlay.classList.remove('active');
});

// Virtual Keyboard Click Handler
document.querySelector('.keyboard-base').addEventListener('click', (e) => {
    focusInput();
    const keyEl = e.target.closest('.key, .space-bar');
    if (keyEl) {
        const key = keyEl.dataset.key;
        visualKeyPress(key);
        if (key === 'Backspace') hiddenInput.value = hiddenInput.value.slice(0, -1);
        else if (key === 'Enter') hiddenInput.value += '\n';
        else if (key === 'Space') hiddenInput.value += ' ';
        else if (key.length === 1) hiddenInput.value += key;
        hiddenInput.dispatchEvent(new Event('input'));
    }
});

// Physical Keyboard Event Handler
document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    focusInput();
    visualKeyPress(e.key);
});

/**
 * Visual feedback for key presses
 * @param {string} keyStr - The key pressed
 */
function visualKeyPress(keyStr) {
    let selector = `[data-key="${keyStr}"]`;
    if (keyStr === ' ') selector = `[data-key=" "]`;
    else if (keyStr.toLowerCase) selector = `[data-key="${keyStr.toLowerCase()}"]`;
    const el = document.querySelector(selector);
    if (el) { el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 100); }
}

/* IME Input Handling - Save state to avoid messing up composition */
let isComposing = false;
let savedValue = '';

hiddenInput.addEventListener('compositionstart', () => {
    console.log('Composition started, saving value:', hiddenInput.value);
    isComposing = true;
    savedValue = hiddenInput.value;
});

hiddenInput.addEventListener('compositionend', (e) => {
    console.log('Composition ended, data:', e.data, 'value:', hiddenInput.value);
    isComposing = false;

    const composedText = e.data || '';
    hiddenInput.value = savedValue + composedText;

    setTimeout(() => {
        applyInputLimits();
    }, 0);
});

hiddenInput.addEventListener('input', (e) => {
    if (isComposing) return;
    applyInputLimits();
});

/**
 * Applies limits to the input text (max lines, max chars per line)
 */
function applyInputLimits() {
    let val = hiddenInput.value;
    const lines = val.split('\n');
    const MAX_LINES = 9;
    const MAX_CHARS_PER_LINE = 30;

    if (lines.length > MAX_LINES) {
        val = lines.slice(0, MAX_LINES).join('\n');
    }

    const truncatedLines = val.split('\n').map(line => {
        return line.length > MAX_CHARS_PER_LINE ? line.slice(0, MAX_CHARS_PER_LINE) : line;
    });
    val = truncatedLines.join('\n');

    if (hiddenInput.value !== val) {
        const cursorPos = hiddenInput.selectionStart;
        hiddenInput.value = val;
        hiddenInput.setSelectionRange(Math.min(cursorPos, val.length), Math.min(cursorPos, val.length));
    }

    typedText.textContent = val;
    if (!val) typedText.innerHTML = '<span style="color:#999">點此輸入心情...</span>';
    else typedText.style.color = '#2b2b2b';
}

// Mood Selection
moodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        moodButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMood = Number(btn.dataset.mood);
    });
});

// Style Selection
styleSelect.addEventListener('change', (e) => currentStyle = e.target.value);

// File Upload
btnUpload.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const originalText = btnUpload.textContent;
    btnUpload.textContent = '處理中...';
    try {
        // Compress and process image
        const processed = await processImageFileSpecV2(f, TARGET_IMAGE_MAX_BYTES);
        currentBase64Parts = processed;
        btnUpload.textContent = '✅ 已就緒';
        setTimeout(() => btnUpload.textContent = originalText, 2000);
        focusInput();
    } catch (err) {
        alert('圖片處理失敗: ' + err.message);
        btnUpload.textContent = originalText;
    }
    fileInput.value = '';
});

/**
 * Processes and compresses the image file
 * @param {File} file - The uploaded file
 * @param {number} targetMaxBytes - Target size in bytes
 */
async function processImageFileSpecV2(file, targetMaxBytes) {
    const img = await createImageBitmap(file);
    const MAX_DIM = 1200;
    const MIN_DIM = 600;
    let w = img.width, h = img.height;
    if (Math.max(w, h) > MAX_DIM) {
        const ratio = MAX_DIM / Math.max(w, h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
    } else if (Math.max(w, h) < MIN_DIM) {
        const ratio = MIN_DIM / Math.max(w, h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
    }
    let quality = 0.9;
    let blob = await drawAndWatermark(img, w, h, quality);
    while (blob.size > targetMaxBytes && quality >= 0.5) {
        quality -= 0.1;
        blob = await drawAndWatermark(img, w, h, quality);
    }
    if (blob.size > targetMaxBytes) throw new Error('圖片過大無法壓縮');
    const dataUrl = await blobToDataURL(blob);
    const idx = dataUrl.indexOf('base64,');
    const header = dataUrl.slice(0, idx + 7);
    const b64Body = dataUrl.slice(idx + 7);
    const parts = splitBase64(b64Body, 3);
    return { mime: blob.type, parts: parts, header: header, sizeBytes: blob.size };
}

/**
 * Draws image to canvas and adds timestamp watermark
 */
function drawAndWatermark(imgBitmap, w, h, q) {
    return new Promise(resolve => {
        const cvs = document.createElement('canvas');
        cvs.width = w; cvs.height = h;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(imgBitmap, 0, 0, w, h);

        const now = new Date();
        const ts = now.getFullYear() + '-' +
            (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
            now.getDate().toString().padStart(2, '0') + ' ' +
            now.getHours().toString().padStart(2, '0') + ':' +
            now.getMinutes().toString().padStart(2, '0');

        const fontSize = Math.max(20, Math.round(w * 0.035));
        ctx.font = `bold ${fontSize}px "Courier New", monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';

        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = Math.max(3, fontSize * 0.2);
        ctx.strokeText(ts, w - 20, h - 20);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(ts, w - 20, h - 20);

        cvs.toBlob(b => resolve(b), 'image/jpeg', q);
    });
}

function blobToDataURL(blob) { return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }); }
function splitBase64(str, n) { const len = Math.ceil(str.length / n); const arr = []; for (let i = 0; i < n; i++) arr.push(str.slice(i * len, (i + 1) * len)); return arr; }

/**
 * Print Button Handler - Creates a new card
 */
printBtn.addEventListener('click', () => {
    const text = hiddenInput.value.trim();
    const existingCards = document.querySelectorAll('.card');

    // Check Card Limit
    if (existingCards.length >= MAX_CARDS) { alert(`心情牆已滿 (${MAX_CARDS}張)！請先刪除舊卡片。`); return; }

    if (!text && !currentBase64Parts) { alert('請寫點東西或上傳圖片'); focusInput(); return; }

    const cardId = 'card_' + Date.now();
    const cardEl = document.createElement('div');
    cardEl.className = `card ${currentStyle} printing`;
    cardEl.dataset.cardId = cardId;
    cardEl.dataset.mood = currentMood;

    let imgHtml = '';
    if (currentBase64Parts) {
        const fullSrc = currentBase64Parts.header + currentBase64Parts.parts.join('');
        imgHtml = `<img src="${fullSrc}">`;
    } else {
        imgHtml = window.PRESET_SVGS[Math.floor(Math.random() * window.PRESET_SVGS.length)];
    }

    cardEl.innerHTML = `
    <div class="delete-btn" title="刪除">×</div>
    <div class="save-btn" title="下載">⬇</div>
    <div class="photo">${imgHtml}</div>
    <div class="text">${text}</div>
    <div class="mood-badge">${window.MOOD_EMOJIS[currentMood] || ''}</div>
    <div class="date-badge">${new Date().toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
  `;

    const tx = Math.random() * (window.innerWidth - 340) + 20;
    const ty = Math.random() * (window.innerHeight - 500) + 20;
    const rot = Math.random() * 10 - 5;

    cardsLayer.appendChild(cardEl);

    setTimeout(() => {
        cardEl.classList.remove('printing');
        cardEl.style.left = tx + 'px';
        cardEl.style.top = ty + 'px';
        cardEl.style.transform = `scale(0.25) rotate(${rot}deg)`;
        setupCardInteraction(cardEl, cardId, tx, ty, rot);
        saveCard(cardEl, text, currentBase64Parts, tx, ty, rot);
        currentBase64Parts = null;
        hiddenInput.value = '';
        typedText.innerHTML = '<span style="color:#999">點此輸入心情...</span>';
        currentMood = 3;
        moodButtons.forEach(b => b.classList.remove('active'));
        moodButtons[2].classList.add('active'); // Reset to neutral
    }, 2500);
});

async function saveCard(cardEl, text, parts, x, y, r) {
    const cardData = {
        id: cardEl.dataset.cardId,
        text: text,
        mood: currentMood,
        style: currentStyle,
        header: parts ? parts.header : '',
        parts: parts ? parts.parts : [],
        x: Math.round(x),
        y: Math.round(y),
        r: Math.round(r),
        createdAt: new Date().toISOString()
    };

    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cardData)
        });
    } catch (e) {
        console.error('Save failed', e);
    }
}

async function loadCards() {
    try {
        const res = await fetch(API_URL);
        const cards = await res.json();
        cards.forEach(cardData => {
            renderCard(cardData);
        });
    } catch (e) {
        console.error('Load failed', e);
    }
}

function renderCard(data) {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${data.style || 'polaroid'}`;
    cardEl.dataset.cardId = data.id;
    cardEl.dataset.mood = data.mood;

    let imgHtml = '';
    if (data.parts && data.parts.length > 0) {
        const fullSrc = (data.header || '') + data.parts.join('');
        imgHtml = `<img src="${fullSrc}">`;
    } else {
        // Fallback or presets if no image
        imgHtml = window.PRESET_SVGS[Math.floor(Math.random() * window.PRESET_SVGS.length)];
    }

    cardEl.innerHTML = `
    <div class="delete-btn" title="刪除">×</div>
    <div class="save-btn" title="下載">⬇</div>
    <div class="photo">${imgHtml}</div>
    <div class="text">${data.text}</div>
    <div class="mood-badge">${window.MOOD_EMOJIS[data.mood] || ''}</div>
    <div class="date-badge">${data.createdAt ? new Date(data.createdAt).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div>
  `;

    const safeR = (data.r === undefined || data.r === null || data.r === '') ? (Math.random() * 10 - 5) : data.r;

    cardEl.style.left = data.x + 'px';
    cardEl.style.top = data.y + 'px';
    cardEl.style.transform = `scale(0.25) rotate(${safeR}deg)`;

    cardsLayer.appendChild(cardEl);
    setupCardInteraction(cardEl, data.id, data.x, data.y, safeR);
}

function setupCardInteraction(cardEl, id, initialX, initialY, initialR) {
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
    let isDragging = false;
    let x = initialX, y = initialY;

    cardEl.onmousedown = dragStart;
    cardEl.ontouchstart = dragStart;

    function dragStart(e) {
        if (e.target.classList.contains('delete-btn') || e.target.classList.contains('save-btn')) return;

        // Bring to front only if needed (prevents dblclick interference)
        if (cardsLayer.lastElementChild !== cardEl) {
            cardsLayer.appendChild(cardEl);
        }

        isDragging = true;
        const evt = e.touches ? e.touches[0] : e;
        startX = evt.clientX;
        startY = evt.clientY;
        initialLeft = parseFloat(cardEl.style.left) || 0;
        initialTop = parseFloat(cardEl.style.top) || 0;
        cardEl.style.transition = 'none';

        document.onmousemove = dragMove;
        document.onmouseup = dragEnd;
        document.ontouchmove = dragMove;
        document.ontouchend = dragEnd;
    }

    function dragMove(e) {
        if (!isDragging) return;
        const evt = e.touches ? e.touches[0] : e;
        const dx = evt.clientX - startX;
        const dy = evt.clientY - startY;
        x = initialLeft + dx;
        y = initialTop + dy;
        cardEl.style.left = x + 'px';
        cardEl.style.top = y + 'px';
    }

    function dragEnd() {
        if (!isDragging) return;
        isDragging = false;
        cardEl.style.transition = 'transform 0.1s';
        document.onmousemove = null;
        document.onmouseup = null;
        document.ontouchmove = null;
        document.ontouchend = null;

        // Save new position
        fetch(`${API_URL}/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: Math.round(x), y: Math.round(y), r: initialR })
        }).catch(err => console.error(err));
    }

    // Delete
    cardEl.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('確定刪除這張卡片嗎？')) {
            try {
                await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
                cardEl.remove();
            } catch (err) {
                alert('刪除失敗');
            }
        }
    });

    // Expand
    cardEl.addEventListener('dblclick', () => {
        cardEl.classList.add('expanded');
        overlay.classList.add('active');
    });

    // Download/Save Image
    cardEl.querySelector('.save-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        let clone;
        try {
            // Clone strategy to avoid visual glitches and cropping
            clone = cardEl.cloneNode(true);

            // Clean up clone styles for capture
            clone.classList.remove('printing', 'expanded');
            clone.style.position = 'fixed';
            clone.style.left = '-9999px'; // Off-screen
            clone.style.top = '0';
            clone.style.transform = 'none';
            clone.style.transition = 'none';
            clone.style.zIndex = '99999';
            clone.style.margin = '0';

            // Remove control buttons from clone
            clone.querySelectorAll('.delete-btn, .save-btn').forEach(b => b.remove());

            document.body.appendChild(clone);

            // Wait a tick for DOM to update
            await new Promise(resolve => setTimeout(resolve, 50));

            const canvas = await html2canvas(clone, {
                scale: 2,
                backgroundColor: null,
                useCORS: true
            });

            const link = document.createElement('a');
            link.download = `card-${id}.png`;
            link.href = canvas.toDataURL();
            link.click();
        } catch (err) {
            console.error(err);
            alert('下載失敗');
        } finally {
            if (clone && document.body.contains(clone)) {
                document.body.removeChild(clone);
            }
        }
    });
}

// Global Presets
window.MOOD_EMOJIS = {
    1: '😫', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄'
};

window.PRESET_SVGS = [
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="40" fill="#FFCC00"/><circle cx="35" cy="40" r="5" fill="#333"/><circle cx="65" cy="40" r="5" fill="#333"/><path d="M 30 65 Q 50 85 70 65" stroke="#333" stroke-width="4" fill="none"/></svg>',
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><rect x="20" y="20" width="60" height="60" fill="#87CEEB"/><path d="M 20 80 L 40 50 L 60 70 L 80 40 L 80 80 Z" fill="#228B22"/><circle cx="70" cy="35" r="8" fill="#FFD700"/></svg>',
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="45" fill="#E6E6FA"/><path d="M 30 30 L 70 70 M 70 30 L 30 70" stroke="#9370DB" stroke-width="10" stroke-linecap="round"/></svg>',
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><rect x="10" y="10" width="80" height="80" rx="20" fill="#FFB7B2"/><circle cx="30" cy="30" r="5" fill="#FFF"/><circle cx="70" cy="30" r="5" fill="#FFF"/><path d="M 30 60 Q 50 80 70 60" stroke="#FFF" stroke-width="4" fill="none"/></svg>',
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="40" fill="#B5EAD7"/><rect x="30" y="30" width="40" height="10" fill="#FFF"/><rect x="30" y="50" width="40" height="10" fill="#FFF"/><rect x="30" y="70" width="40" height="10" fill="#FFF"/></svg>',
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><polygon points="50,15 90,85 10,85" fill="#C7CEEA"/><circle cx="50" cy="55" r="15" fill="#FFF" opacity="0.6"/></svg>'
];
