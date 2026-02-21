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

/** Check if running inside Electron */
const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);
log.info(`Runtime: ${isElectron ? 'Electron' : 'Browser'}`);

// ─── State ───────────────────────────────────────────────────────────
const state = {
    layout: '2', // '2', '3', '4'
    images: [null, null], // Array of { file, img, info } | null
    mergedCanvas: null,
    batchPairs: [],
    batchProcessing: false,
    lastFocusedIndex: 0,
};

// ─── DOM Refs ────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
    layoutBtns: $$('.layout-btn'),
    dropGrid: $('#drop-grid'),
    resizeMode: $('#resize-mode'),
    outWidth: $('#out-width'),
    outHeight: $('#out-height'),
    bgColor: $('#bg-color'),
    jpgQuality: $('#jpg-quality'),
    previewCanvas: $('#preview-canvas'),
    previewPlaceholder: $('#preview-placeholder'),
    previewInfo: $('#preview-info'),
    previewWrapper: $('#preview-wrapper'),
    btnSavePng: $('#btn-save-png'),
    btnSaveJpg: $('#btn-save-jpg'),
    btnCopy: $('#btn-copy'),
    toastContainer: $('#toast-container'),
    // Batch (kept simple for now, focuses on layout 2)
    batchDrop: $('#batch-drop'),
    batchFileInput: $('#batch-file-input'),
    batchPairsList: $('#batch-pairs-list'),
    batchEmpty: $('#batch-empty'),
    btnBatchMerge: $('#btn-batch-merge'),
    btnBatchClear: $('#btn-batch-clear'),
    batchProgress: $('#batch-progress'),
    batchProgressBar: $('#batch-progress-bar'),
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

// ─── Layout Switching ────────────────────────────────────────────────
function setLayout(layout) {
    if (state.layout === layout) return;
    state.layout = layout;

    // Update active button
    DOM.layoutBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === layout);
    });

    // Resize state.images array
    const targetSize = parseInt(layout);
    if (state.images.length > targetSize) {
        state.images.length = targetSize; // Truncate
    } else {
        while (state.images.length < targetSize) {
            state.images.push(null); // Expand
        }
    }

    renderDropZones();
    updatePreview();

    // Auto-disable output size controls for fixed-dimension layouts
    const isFixed = (layout === '3' || layout === '4');
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

    log.info(`Layout switched to: ${layout}`);
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
        } else {
            // Empty
            zone.innerHTML = `
                <span class="drop-icon">🖼️</span>
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

        // Drag Events
        zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
        zone.ondragleave = () => zone.classList.remove('drag-over');
        zone.ondrop = (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handleImageSet(index, e.dataTransfer.files[0]);
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
    // Check if we have enough images to at least try merging
    // Layout 2 needs 2 images? Or just 1? Allow partial preview?
    // Let's require all slots filled for 3/4, or at least 2 for layout 2.
    // Making it robust: Any valid image contributes.

    const validImages = state.images.map(s => s ? s.img : null);
    const hasAny = validImages.some(img => img !== null);

    if (!hasAny) {
        DOM.previewCanvas.style.display = 'none';
        DOM.previewPlaceholder.style.display = 'block';
        DOM.previewInfo.style.display = 'none';
        DOM.previewPlaceholder.textContent = 'Add images to see preview';
        setActionButtons(false);
        state.mergedCanvas = null;
        return;
    }

    try {
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
        // Only show toast if it's a real error, not just "not enough images"
        if (!err.message.includes('requires at least')) {
            showToast('Preview error: ' + err.message, 'error');
        }
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

DOM.btnSavePng.addEventListener('click', async () => {
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
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
});

DOM.btnSaveJpg.addEventListener('click', async () => {
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
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
});

DOM.btnCopy.addEventListener('click', async () => {
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
    } catch (e) { showToast('Copy failed: ' + e.message, 'error'); }
});

// ─── Reset All ───────────────────────────────────────────────────────
$('#btn-reset-all').addEventListener('click', () => {
    state.images = state.images.map(() => null);
    state.mergedCanvas = null;
    renderDropZones();
    updatePreview();
    showToast('All images cleared', 'success');
    log.info('Reset all images');
});

// ─── Batch Mode (Stubbed for now, kept existing structure) ───────────
// Batch mode logic is largely compatible, assuming logic matches layout 2.
// For now, I'll keep the UI for Batch Mode accessible but it will default to Layout 2 behavior (pair merging).

// ─── Init ────────────────────────────────────────────────────────────
renderDropZones();
log.info('App initialized with dynamic layouts');
