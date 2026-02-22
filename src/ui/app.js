/**
 * App — UI Controller for Art Split Merger (Electron + Browser compatible)
 * 
 * Wires DOM events to core image processing logic.
 * Handles drag & drop, file upload, clipboard paste, preview rendering,
 * save/export, batch mode, and all UI interactions.
 */

import { loadImage, mergeImages, exportAs, getImageInfo } from '../core/imageProcessor.js';
import { validateFile, validateClipboardItem } from '../core/imageValidator.js';
import { Logger } from '../core/logger.js';

const log = new Logger('App');

// ─── Constants & Runtime ─────────────────────────────────────────────
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);
log.info(`Runtime: ${isElectron ? 'Electron' : 'Browser'}`);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── State ───────────────────────────────────────────────────────────
const state = {
    layout: '2',          // Current layout ID: '2', '3', '4'
    images: [null, null], // Array of { file, img, info } | null
    mergedCanvas: null,   // The final merged result as canvas
    batchPairs: [],       // For batch mode (future)
    batchProcessing: false,
    lastFocusedIndex: 0,  // Index of last interacted slot (for paste)
    isProcessing: false,  // Image processing guard for spinner
};

// ─── DOM Elements ────────────────────────────────────────────────────
const DOM = {
    // Top Bar / Layout
    layoutBtns: $$('.layout-btn'),

    // Grid
    dropGrid: $('#drop-grid'),

    // Controls Panel
    resizeMode: $('#resize-mode'),
    outWidth: $('#out-width'),
    outHeight: $('#out-height'),
    bgColor: $('#bg-color'),
    jpgQuality: $('#jpg-quality'),

    // Preview Section
    previewCanvas: $('#preview-canvas'),
    previewPlaceholder: $('#preview-placeholder'),
    previewInfo: $('#preview-info'),
    previewWrapper: $('#preview-wrapper'),

    // Action Buttons
    btnSavePng: $('#btn-save-png'),
    btnSaveJpg: $('#btn-save-jpg'),
    btnCopy: $('#btn-copy'),
    btnReset: $('#btn-reset-all'),

    // UI Feedback
    toastContainer: $('#toast-container'),

    // Batch Mode Elements
    batch: {
        drop: $('#batch-drop'),
        input: $('#batch-file-input'),
        list: $('#batch-pairs-list'),
        empty: $('#batch-empty'),
        mergeBtn: $('#btn-batch-merge'),
        clearBtn: $('#btn-batch-clear'),
        progress: $('#batch-progress'),
        progressBar: $('#batch-progress-bar'),
    },
};

// ─── Toast ───────────────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toast-out 200ms ease forwards';
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

// ─── Layout Logic ────────────────────────────────────────────────────
function setLayout(layoutId) {
    if (state.layout === layoutId) return;

    updateLayoutState(layoutId);
    syncLayoutUI(layoutId);

    renderDropZones();
    updatePreview();

    log.info(`Layout switched to: ${layoutId}`);
}

function updateLayoutState(layoutId) {
    state.layout = layoutId;

    // Resize state.images array based on layout capacity
    const targetSize = parseInt(layoutId);
    if (state.images.length > targetSize) {
        state.images.length = targetSize; // Truncate
    } else {
        while (state.images.length < targetSize) {
            state.images.push(null); // Expand
        }
    }
}

function syncLayoutUI(layoutId) {
    // Update active button state
    DOM.layoutBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === layoutId);
    });

    // Handle fixed-dimension layouts (3 & 4)
    const isFixed = (layoutId === '3' || layoutId === '4');
    DOM.outWidth.disabled = isFixed;
    DOM.outHeight.disabled = isFixed;

    if (isFixed) {
        DOM.outWidth.value = '';
        DOM.outHeight.value = '';
        DOM.outWidth.placeholder = '3000';
        DOM.outHeight.placeholder = '3000';
    } else {
        DOM.outWidth.placeholder = 'auto';
        DOM.outHeight.placeholder = 'auto';
    }
}

DOM.layoutBtns.forEach(btn => {
    btn.addEventListener('click', () => setLayout(btn.dataset.layout));
});

// ─── Drop Zone Rendering ─────────────────────────────────────────────
function renderDropZones() {
    DOM.dropGrid.innerHTML = '';

    state.images.forEach((slotData, index) => {
        const zone = document.createElement('div');
        zone.className = 'drop-zone';
        zone.dataset.index = index;

        // Custom Layout Styling
        if (state.layout === '3' && index === 2) {
            zone.classList.add('span-full'); // Bottom slot spans width
        }

        if (slotData) {
            // Has Image
            zone.classList.add('has-image');
            zone.draggable = true;

            const thumb = document.createElement('img');
            thumb.className = 'preview-thumb';
            thumb.src = URL.createObjectURL(slotData.file);

            const info = document.createElement('span');
            info.className = 'img-info';
            info.textContent = `${slotData.info.width}×${slotData.info.height} — ${slotData.file.name}`;

            const clearBtn = document.createElement('button');
            clearBtn.className = 'clear-btn';
            clearBtn.innerHTML = '&times;';
            clearBtn.title = 'Remove';
            clearBtn.onclick = (e) => {
                e.stopPropagation();
                clearSlot(index);
            };

            zone.append(thumb, info, clearBtn);

            // Drag out (Source)
            zone.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', index);
                e.dataTransfer.effectAllowed = 'move';
                zone.classList.add('is-dragging');
                document.body.classList.add('is-dragging-active');
                log.debug(`Drag start: slot ${index}`);
            };
            zone.ondragend = () => {
                zone.classList.remove('is-dragging');
                document.body.classList.remove('is-dragging-active');
            };

        } else {
            // Empty
            zone.innerHTML = `
                <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span class="label">Image ${index + 1}</span>
                <span class="hint">Drop or Paste</span>
                <input type="file" class="hidden-input" accept="image/*">
            `;

            // File Input
            const input = zone.querySelector('input');
            input.onchange = (e) => {
                if (e.target.files[0]) handleImageSet(index, e.target.files[0]);
            };

            // Click to browse
            zone.onclick = () => {
                state.lastFocusedIndex = index;
                input.click();
            };
        }

        // Drag Events (Global for zone)
        zone.ondragover = (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
            e.dataTransfer.dropEffect = 'move';
        };

        zone.ondragleave = () => zone.classList.remove('drag-over');

        zone.ondrop = (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');

            const sourceIdx = e.dataTransfer.getData('text/plain');

            // If dropping a file from OS
            if (e.dataTransfer.files.length > 0) {
                handleImageSet(index, e.dataTransfer.files[0]);
                return;
            }

            // If internal swap
            if (sourceIdx !== '' && sourceIdx !== index.toString()) {
                swapSlots(parseInt(sourceIdx), index);
            }
        };

        // Track focus for paste
        zone.onmouseenter = () => { state.lastFocusedIndex = index; };

        DOM.dropGrid.appendChild(zone);
    });
}

function clearSlot(index) {
    state.images[index] = null;
    renderDropZones();
    updatePreview();
}

function swapSlots(idx1, idx2) {
    log.info(`Swapping slots ${idx1} and ${idx2}`);
    const temp = state.images[idx1];
    state.images[idx1] = state.images[idx2];
    state.images[idx2] = temp;
    renderDropZones();
    updatePreview();
}

// ─── Image Loading ───────────────────────────────────────────────────
async function handleImageSet(index, file) {
    const validation = validateFile(file);
    if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
    }

    try {
        const img = await loadImage(file);
        const info = getImageInfo(img);

        state.images[index] = { file, img, info };
        renderDropZones();
        log.info(`Set image ${index}: ${file.name}`);
        await updatePreview();
    } catch (err) {
        log.error(`Failed to load image ${index}:`, err);
        showToast(`Failed to load: ${err.message}`, 'error');
    }
}

// ─── Preview ─────────────────────────────────────────────────────────
async function updatePreview() {
    if (state.isProcessing) return;

    const validImages = state.images.map(s => s ? s.img : null);
    const hasAny = validImages.some(img => img !== null);

    if (!hasAny) {
        DOM.previewCanvas.style.display = 'none';
        DOM.previewPlaceholder.style.display = 'flex';
        DOM.previewInfo.style.display = 'none';
        DOM.previewPlaceholder.innerHTML = 'Add images to see preview';
        setActionButtons(false);
        state.mergedCanvas = null;
        return;
    }

    try {
        state.isProcessing = true;

        // Show Loading Spinner
        DOM.previewPlaceholder.innerHTML = `
            <div class="loading-spinner"></div>
            <p style="margin-top:12px; font-size:0.9rem; color:var(--text-secondary);">Processing high-quality merge...</p>
        `;
        DOM.previewPlaceholder.style.display = 'flex';
        DOM.previewPlaceholder.style.flexDirection = 'column';
        DOM.previewCanvas.style.display = 'none';
        DOM.previewInfo.style.display = 'none';

        const options = {
            layout: state.layout,
            width: parseInt(DOM.outWidth.value) || 0,
            height: parseInt(DOM.outHeight.value) || 0,
            bgColor: DOM.bgColor.value,
            mode: DOM.resizeMode.value,
        };

        const result = await mergeImages(validImages, options);

        const pc = DOM.previewCanvas;
        pc.width = result.width;
        pc.height = result.height;
        const ctx = pc.getContext('2d');
        ctx.drawImage(result.canvas, 0, 0);

        state.mergedCanvas = result.canvas;

        DOM.previewCanvas.style.display = 'block';
        DOM.previewPlaceholder.style.display = 'none';
        DOM.previewInfo.style.display = 'block';
        DOM.previewInfo.textContent = `${result.width} × ${result.height} px`;

        setActionButtons(true);
    } catch (err) {
        log.error('Preview failed:', err);
        if (!err.message.includes('requires at least')) {
            showToast('Preview error: ' + err.message, 'error');
        }
        DOM.previewPlaceholder.innerHTML = 'Add images to see preview';
        DOM.previewPlaceholder.style.display = 'flex';
    } finally {
        state.isProcessing = false;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────
function setActionButtons(enabled) {
    DOM.btnSavePng.disabled = !enabled;
    DOM.btnSaveJpg.disabled = !enabled;
    DOM.btnCopy.disabled = !enabled;
}

function getQuality() {
    return Math.max(1, Math.min(100, parseInt(DOM.jpgQuality.value) || 92)) / 100;
}

// ─── Clipboard Paste ─────────────────────────────────────────────────
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const result = validateClipboardItem(item);
            if (result.valid) {
                const idx = state.lastFocusedIndex;
                const ext = result.file.type.split('/')[1] === 'jpeg' ? 'jpg' : result.file.type.split('/')[1];
                const namedFile = new File([result.file], `paste.${ext}`, { type: result.file.type });
                handleImageSet(idx, namedFile);
            }
            return;
        }
    }
});

// ─── Controls Events ─────────────────────────────────────────────────
DOM.resizeMode.addEventListener('change', updatePreview);
DOM.outWidth.addEventListener('input', updatePreview);
DOM.outHeight.addEventListener('input', updatePreview);
DOM.bgColor.addEventListener('input', updatePreview);

// ─── Keyboard Shortcuts ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (!state.mergedCanvas) return;

    // Ctrl+S → Save PNG
    if (e.ctrlKey && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        DOM.btnSavePng.click();
    }
    // Ctrl+Shift+S → Save JPG
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        DOM.btnSaveJpg.click();
    }
    // Ctrl+Shift+C → Copy to Clipboard
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        DOM.btnCopy.click();
    }
});

// ─── Save / Export Actions ───────────────────────────────────────────
async function canvasToArrayBuffer(canvas, format, quality) {
    const blob = await exportAs(canvas, format, quality);
    return await blob.arrayBuffer();
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Action Handlers ─────────────────────────────────────────────────
async function handleSavePng() {
    if (!state.mergedCanvas) return;
    try {
        if (isElectron) {
            const buffer = await canvasToArrayBuffer(state.mergedCanvas, 'png');
            const res = await window.electronAPI.saveFile(buffer, 'merged.png', 'png');
            if (res.success) showToast(`Saved: ${res.filePath}`);
        } else {
            const blob = await exportAs(state.mergedCanvas, 'png');
            downloadBlob(blob, 'merged.png');
        }
    } catch (e) {
        log.error('PNG Save failed:', e);
        showToast('Save failed: ' + e.message, 'error');
    }
}

async function handleSaveJpg() {
    if (!state.mergedCanvas) return;
    try {
        if (isElectron) {
            const buffer = await canvasToArrayBuffer(state.mergedCanvas, 'jpeg', getQuality());
            const res = await window.electronAPI.saveFile(buffer, 'merged.jpg', 'jpg');
            if (res.success) showToast(`Saved: ${res.filePath}`);
        } else {
            const blob = await exportAs(state.mergedCanvas, 'jpeg', getQuality());
            downloadBlob(blob, 'merged.jpg');
        }
    } catch (e) {
        log.error('JPG Save failed:', e);
        showToast('Save failed: ' + e.message, 'error');
    }
}

async function handleCopyToClipboard() {
    if (!state.mergedCanvas) return;
    try {
        if (isElectron) {
            const dataURL = state.mergedCanvas.toDataURL('image/png');
            const res = await window.electronAPI.copyToClipboard(dataURL);
            if (res.success) showToast('Copied to clipboard');
        } else {
            const blob = await exportAs(state.mergedCanvas, 'png');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('Copied to clipboard');
        }
    } catch (e) {
        log.error('Copy failed:', e);
        showToast('Copy failed: ' + e.message, 'error');
    }
}

function handleResetAll() {
    if (state.images.every(img => img === null)) return;

    state.images = state.images.map(() => null);
    state.mergedCanvas = null;
    renderDropZones();
    updatePreview();
    showToast('All images cleared', 'success');
    log.info('Reset all images');
}

DOM.btnSavePng.addEventListener('click', handleSavePng);
DOM.btnSaveJpg.addEventListener('click', handleSaveJpg);
DOM.btnCopy.addEventListener('click', handleCopyToClipboard);
DOM.btnReset.addEventListener('click', handleResetAll);



// ─── Batch Mode (Stubbed for now, kept existing structure) ───────────
// Batch mode logic is largely compatible, assuming logic matches layout 2.
// For now, I'll keep the UI for Batch Mode accessible but it will default to Layout 2 behavior (pair merging).

// ─── Init ────────────────────────────────────────────────────────────
renderDropZones();
log.info('App initialized with dynamic layouts');
