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
    layout: '2',          // '2', '3', '4', 'custom'
    customGrid: { rows: 2, cols: 3 }, // Default for custom mode
    spacing: 0,           // Gap between images in px
    images: [null, null], // Array of { file, img, info } | null
    mergedCanvas: null,   // The final merged result as canvas
    batchPairs: [],       // For batch mode (future)
    batchProcessing: false,
    lastFocusedIndex: 0,  // Index of last interacted slot (for paste)
    isProcessing: false,  // Image processing guard for spinner
    crop: {
        active: false,
        index: -1,
        rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        dragging: false,
        resizing: false,
        handle: null,
        startX: 0,
        startY: 0
    }
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
        gapInput: $('#spacing-gap'),
        templateSelect: $('#layout-templates'),
        smartGrouping: $('#batch-smart-grouping'),
        results: $('#batch-results'),
        resultsGrid: $('#batch-results-grid'),
    },

    // Crop Modal
    cropModal: $('#crop-modal'),
    cropImage: $('#crop-image-source'),
    cropSelector: $('#crop-selector'),
    btnCropSave: $('#btn-crop-save'),
    btnCropCancel: $('#btn-crop-cancel')
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
    let targetSize = parseInt(layoutId) || 0;
    if (layoutId === 'custom') {
        targetSize = state.customGrid.rows * state.customGrid.cols;
    }

    if (state.images.length > targetSize) {
        state.images.length = targetSize; // Truncate
    } else {
        while (state.images.length < targetSize) {
            state.images.push(null); // Expand
        }
    }
}

const DEFAULT_TRANSFORM = {
    rotate: 0,
    flipH: false,
    flipV: false,
    brightness: 0,
    contrast: 0
};

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

    if (state.layout === 'custom') {
        DOM.dropGrid.style.gridTemplateColumns = `repeat(${state.customGrid.cols}, 1fr)`;
        DOM.dropGrid.classList.add('is-custom');
    } else {
        DOM.dropGrid.style.gridTemplateColumns = '';
        DOM.dropGrid.classList.remove('is-custom');
    }

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

            // Edit Toolbar
            const toolbar = document.createElement('div');
            toolbar.className = 'edit-toolbar';

            // Transform row
            const transformRow = document.createElement('div');
            transformRow.className = 'toolbar-row';
            transformRow.append(
                createToolbarBtn('rotate-ccw', '↺', 'Rotate 90° CCW', () => applyTransform(index, 'rotate', -90)),
                createToolbarBtn('rotate-cw', '↻', 'Rotate 90° CW', () => applyTransform(index, 'rotate', 90)),
                createToolbarBtn('flip-h', '↔', 'Flip Horizontal', () => applyTransform(index, 'flipH')),
                createToolbarBtn('flip-v', '↕', 'Flip Vertical', () => applyTransform(index, 'flipV')),
                createToolbarBtn('crop', '✂', 'Crop Image', () => openCropModal(index))
            );

            // Sliders area
            const sliders = document.createElement('div');
            sliders.className = 'edit-sliders';
            sliders.append(
                createSliderGroup('Brightness', slotData.transform.brightness, (val) => applyTransform(index, 'brightness', val)),
                createSliderGroup('Contrast', slotData.transform.contrast, (val) => applyTransform(index, 'contrast', val))
            );

            toolbar.append(transformRow, sliders);

            zone.append(thumb, info, clearBtn, toolbar);

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

function createToolbarBtn(type, icon, title, onClick) {
    const btn = document.createElement('button');
    btn.className = `toolbar-btn btn-${type}`;
    btn.innerHTML = icon;
    btn.title = title;
    btn.onclick = (e) => {
        e.stopPropagation();
        onClick();
    };
    return btn;
}

function applyTransform(index, type, value) {
    const imgData = state.images[index];
    if (!imgData) return;

    if (type === 'rotate') {
        imgData.transform.rotate = (imgData.transform.rotate + value + 360) % 360;
    } else if (type === 'brightness' || type === 'contrast') {
        imgData.transform[type] = parseInt(value);
    } else {
        imgData.transform[type] = !imgData.transform[type];
    }

    log.debug(`Transform applied to ${index}: ${type}=${imgData.transform[type]}`);
    updatePreview();
}

function createSliderGroup(label, value, onChange) {
    const group = document.createElement('div');
    group.className = 'slider-group';

    const lbl = document.createElement('label');
    lbl.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '-50';
    input.max = '50';
    input.value = value;
    input.oninput = (e) => onChange(e.target.value);

    group.append(lbl, input);
    return group;
}

// ─── Crop Logic ─────────────────────────────────────────────────────
function openCropModal(index) {
    const imgData = state.images[index];
    if (!imgData) return;

    state.crop.active = true;
    state.crop.index = index;
    state.crop.rect = imgData.transform.crop || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

    DOM.cropImage.src = URL.createObjectURL(imgData.file);
    DOM.cropModal.classList.add('active');

    // Wait for image to load to position the selector
    DOM.cropImage.onload = () => {
        updateCropSelectorUI();
    };
}

function updateCropSelectorUI() {
    const { x, y, w, h } = state.crop.rect;

    DOM.cropSelector.style.left = `${x * 100}%`;
    DOM.cropSelector.style.top = `${y * 100}%`;
    DOM.cropSelector.style.width = `${w * 100}%`;
    DOM.cropSelector.style.height = `${h * 100}%`;
}

function closeCropModal() {
    state.crop.active = false;
    DOM.cropModal.classList.remove('active');
}

DOM.btnCropCancel.onclick = closeCropModal;

DOM.btnCropSave.onclick = async () => {
    const imgData = state.images[state.crop.index];
    if (imgData) {
        imgData.transform.crop = { ...state.crop.rect };
        try {
            await updatePreview();
        } catch (err) {
            log.warn('Could not update preview after crop:', err);
        }
    }
    closeCropModal();
};

// Mouse Events for Cropping
DOM.cropSelector.onmousedown = (e) => {
    if (e.target.classList.contains('handle')) {
        state.crop.resizing = true;
        state.crop.handle = e.target.classList[1]; // nw, ne, etc
    } else {
        state.crop.dragging = true;
    }
    state.crop.startX = e.clientX;
    state.crop.startY = e.clientY;
    e.preventDefault();
};

window.addEventListener('mousemove', (e) => {
    if (!state.crop.active || (!state.crop.dragging && !state.crop.resizing)) return;

    const imgRect = DOM.cropImage.getBoundingClientRect();
    const dx = (e.clientX - state.crop.startX) / imgRect.width;
    const dy = (e.clientY - state.crop.startY) / imgRect.height;

    const r = state.crop.rect;

    if (state.crop.dragging) {
        r.x = Math.max(0, Math.min(1 - r.w, r.x + dx));
        r.y = Math.max(0, Math.min(1 - r.h, r.y + dy));
    } else if (state.crop.resizing) {
        if (state.crop.handle.includes('e')) r.w = Math.max(0.1, Math.min(1 - r.x, r.w + dx));
        if (state.crop.handle.includes('s')) r.h = Math.max(0.1, Math.min(1 - r.y, r.h + dy));
        if (state.crop.handle.includes('w')) {
            const newW = Math.max(0.1, r.w - dx);
            r.x += (r.w - newW);
            r.w = newW;
        }
        if (state.crop.handle.includes('n')) {
            const newH = Math.max(0.1, r.h - dy);
            r.y += (r.h - newH);
            r.h = newH;
        }
    }

    state.crop.startX = e.clientX;
    state.crop.startY = e.clientY;
    updateCropSelectorUI();
});

window.addEventListener('mouseup', () => {
    state.crop.dragging = false;
    state.crop.resizing = false;
});

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

        state.images[index] = {
            file,
            img,
            info,
            transform: { ...DEFAULT_TRANSFORM }
        };
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
            spacing: state.spacing,
            customGrid: state.customGrid,
            transforms: state.images.map(img => img ? img.transform : {})
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
DOM.gapInput.addEventListener('input', async () => {
    state.spacing = parseInt(DOM.gapInput.value) || 0;
    await updatePreview();
});

DOM.templateSelect.addEventListener('change', () => {
    const val = DOM.templateSelect.value;
    if (!val) return;

    if (val === '2' || val === '3' || val === '4') {
        setLayout(val);
    } else if (val.includes('x')) {
        const [rows, cols] = val.split('x').map(n => parseInt(n));
        state.customGrid.rows = rows;
        state.customGrid.cols = cols;
        setLayout('custom');
    }
});

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



// ─── Batch Mode ──────────────────────────────────────────────────────
const batchState = {
    groups: [], // Array of File arrays [[f1, f2], [f3, f4]]
    results: [], // Array of { name, blob }
    isProcessing: false
};

function updateBatchUI() {
    DOM.batch.list.innerHTML = '';

    if (batchState.groups.length === 0) {
        DOM.batch.empty.style.display = 'block';
        DOM.batch.mergeBtn.disabled = true;
        DOM.batch.clearBtn.disabled = true;
        return;
    }

    DOM.batch.empty.style.display = 'none';
    DOM.batch.mergeBtn.disabled = false;
    DOM.batch.clearBtn.disabled = false;

    batchState.groups.forEach((group, i) => {
        const item = document.createElement('div');
        item.className = 'batch-item';
        const names = group.map(f => f.name).join(' + ');
        item.innerHTML = `
            <span class="batch-index">${i + 1}</span>
            <span class="batch-names" title="${names}">${names}</span>
            <button class="remove-batch" data-index="${i}">&times;</button>
        `;
        DOM.batch.list.appendChild(item);
    });
}

async function handleBatchDrop(files) {
    const validFiles = Array.from(files).filter(f => validateFile(f).valid);
    if (validFiles.length === 0) return;

    // Determine group size based on layout
    let groupSize = parseInt(state.layout) || 2;
    if (state.layout === 'custom') {
        groupSize = state.customGrid.rows * state.customGrid.cols;
    }

    if (DOM.batch.smartGrouping.checked) {
        const smartGroups = groupFilesSmartly(validFiles, groupSize);
        batchState.groups.push(...smartGroups);
    } else {
        // Simple grouping (sequential)
        for (let i = 0; i < validFiles.length; i += groupSize) {
            const group = validFiles.slice(i, i + groupSize);
            if (group.length === groupSize) {
                batchState.groups.push(group);
            }
        }
    }

    updateBatchUI();
    log.info(`Added ${validFiles.length} files to batch queue. Total groups: ${batchState.groups.length}`);
}

/**
 * Intelligent grouping by filename patterns
 * e.g. "cover_L.png", "cover_R.png" -> Group
 */
function groupFilesSmartly(files, groupSize) {
    const groups = [];
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));

    // Group by common prefix (everything before last underscore or space)
    const map = new Map();

    sorted.forEach(f => {
        const name = f.name.replace(/\.[^/.]+$/, ""); // strip ext
        let base = name;

        // Find last separator
        const lastIdx = Math.max(name.lastIndexOf('_'), name.lastIndexOf(' '), name.lastIndexOf('-'));
        if (lastIdx > 0) {
            base = name.substring(0, lastIdx);
        }

        if (!map.has(base)) map.set(base, []);
        map.get(base).push(f);
    });

    for (const [, group] of map) {
        if (group.length >= groupSize) {
            // If group is larger than required, slice it (might happen if prefix matches too much)
            for (let i = 0; i < group.length; i += groupSize) {
                const sub = group.slice(i, i + groupSize);
                if (sub.length === groupSize) groups.push(sub);
            }
        }
    }

    return groups;
}

async function runBatchMerge() {
    if (batchState.isProcessing || batchState.groups.length === 0) return;

    try {
        batchState.isProcessing = true;
        batchState.results = [];
        DOM.batch.mergeBtn.disabled = true;
        DOM.batch.progress.style.display = 'block';

        const total = batchState.groups.length;

        for (let i = 0; i < total; i++) {
            const group = batchState.groups[i];
            const progress = Math.round((i / total) * 100);
            DOM.batch.progressBar.style.width = `${progress}%`;

            log.info(`Processing Batch ${i + 1}/${total}: ${group[0].name}...`);

            // Load all images for this group
            const imgs = await Promise.all(group.map(f => loadImage(f)));

            const options = {
                layout: state.layout,
                width: parseInt(DOM.outWidth.value) || 0,
                height: parseInt(DOM.outHeight.value) || 0,
                bgColor: DOM.bgColor.value,
                mode: DOM.resizeMode.value,
                spacing: state.spacing,
                customGrid: state.customGrid,
                transforms: group.map(() => ({ ...DEFAULT_TRANSFORM }))
            };

            const result = await mergeImages(imgs, options);
            const blob = await exportAs(result.canvas, 'png');

            const baseName = group[0].name.replace(/\.[^/.]+$/, "");
            batchState.results.push({
                name: `${baseName}_merged.png`,
                blob: blob
            });
        }

        DOM.batch.progressBar.style.width = '100%';
        showToast(`Batch merge complete! ${total} images generated.`, 'success');

        displayBatchResults();

        await handleBatchExport();

    } catch (err) {
        log.error('Batch processing failed:', err);
        showToast('Batch failed: ' + err.message, 'error');
    } finally {
        batchState.isProcessing = false;
        DOM.batch.mergeBtn.disabled = false;
        DOM.batch.progress.style.display = 'none';
    }
}

async function handleBatchExport() {
    if (batchState.results.length === 0) return;

    // Use JSZip to bundle if more than 1
    if (batchState.results.length > 1) {
        if (!window.JSZip) {
            showToast('JSZip not loaded. Saving images individually.', 'warning');
            for (const res of batchState.results) {
                downloadBlob(res.blob, res.name);
            }
            return;
        }

        const zip = new window.JSZip();
        batchState.results.forEach(res => {
            zip.file(res.name, res.blob);
        });

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(zipBlob, 'merged_batch.zip');
    } else {
        downloadBlob(batchState.results[0].blob, batchState.results[0].name);
    }
}

function displayBatchResults() {
    DOM.batch.resultsGrid.innerHTML = '';
    DOM.batch.results.style.display = 'block';

    batchState.results.forEach(res => {
        const item = document.createElement('div');
        item.className = 'result-thumb-container';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(res.blob);
        img.className = 'result-thumb';

        const label = document.createElement('span');
        label.textContent = res.name;
        label.className = 'result-label';

        item.append(img, label);
        DOM.batch.resultsGrid.appendChild(item);
    });
}

// Batch Events
DOM.batch.drop.ondragover = (e) => {
    e.preventDefault();
    DOM.batch.drop.classList.add('drag-over');
};
DOM.batch.drop.ondragleave = () => DOM.batch.drop.classList.remove('drag-over');
DOM.batch.drop.ondrop = (e) => {
    e.preventDefault();
    DOM.batch.drop.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleBatchDrop(e.dataTransfer.files);
};

DOM.batch.drop.onclick = () => DOM.batch.input.click();
DOM.batch.input.onchange = (e) => {
    if (e.target.files.length > 0) handleBatchDrop(e.target.files);
};

DOM.batch.mergeBtn.onclick = runBatchMerge;
DOM.batch.clearBtn.onclick = () => {
    batchState.groups = [];
    updateBatchUI();
};

DOM.batch.list.onclick = (e) => {
    if (e.target.classList.contains('remove-batch')) {
        const idx = parseInt(e.target.dataset.index);
        batchState.groups.splice(idx, 1);
        updateBatchUI();
    }
};

// ─── Init ────────────────────────────────────────────────────────────
renderDropZones();
log.info('App initialized with dynamic layouts');
