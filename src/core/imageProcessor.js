/**
 * ImageProcessor — Core merge logic with support for multiple layouts and smart upscaling.
 * 
 * Layouts:
 * - '2': Split (Left/Right) - original logic
 * - '3': Mixed (2 Top, 1 Bottom) - fixed 3000x3000px
 * - '4': Grid (2x2) - fixed 3000x3000px
 * 
 * Smart Upscaling:
 * - Uses Pica (Lanczos3) if available via window.pica
 * - Falls back to Canvas API (bilinear)
 */

import { Logger } from './logger.js';

const log = new Logger('ImageProcessor');

// Pica instance (lazy loaded from global)
const getPica = () => (window.pica ? window.pica() : null);

/**
 * @typedef {Object} MergeOptions
 * @property {string} [layout]   - '2', '3', or '4' (default: '2')
 * @property {number} [width]    - Custom width (only for layout '2')
 * @property {number} [height]   - Custom height (only for layout '2')
 * @property {string} [bgColor]  - Background color
 * @property {'fit'|'stretch'} [mode] - Resize mode
 * @property {number} [quality]  - JPG quality
 */

/**
 * Load a File into an HTMLImageElement.
 */
export function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            log.debug(`Loaded image: ${img.naturalWidth}×${img.naturalHeight}`);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image.'));
        };
        img.src = url;
    });
}

export function createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d') };
}

function fitInBox(srcW, srcH, targetW, targetH) {
    const scale = Math.min(targetW / srcW, targetH / srcH);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    const offsetX = Math.round((targetW - w) / 2);
    const offsetY = Math.round((targetH - h) / 2);
    return { w, h, offsetX, offsetY };
}

/**
 * High-quality resize and draw using Pica (if available) or Canvas.
 */
async function drawSmart(ctx, img, x, y, w, h, mode, bgColor) {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;

    // Calculate target dimensions
    let drawW, drawH, drawX, drawY;

    if (mode === 'stretch') {
        drawW = w;
        drawH = h;
        drawX = 0;
        drawY = 0;
    } else {
        const fit = fitInBox(srcW, srcH, w, h);
        drawW = fit.w;
        drawH = fit.h;
        drawX = fit.offsetX;
        drawY = fit.offsetY;
    }

    const pica = getPica();

    if (pica) {
        // Create temp canvas for the resized image
        const temp = document.createElement('canvas');
        temp.width = drawW;
        temp.height = drawH;

        await pica.resize(img, temp, {
            unsharpAmount: 80,
            unsharpRadius: 0.6,
            unsharpThreshold: 2
        });

        // Fill background of target area if needed (for fit mode)
        if (mode === 'fit') {
            ctx.fillStyle = bgColor;
            ctx.fillRect(x, y, w, h);
        }

        ctx.drawImage(temp, x + drawX, y + drawY);
    } else {
        // Fallback: Standard Canvas draw
        if (mode === 'fit') {
            ctx.fillStyle = bgColor;
            ctx.fillRect(x, y, w, h);
        }
        ctx.drawImage(img, x + drawX, y + drawY, drawW, drawH);
    }
}

/**
 * Main Merge Function
 * @param {HTMLImageElement[]} images - Array of loaded images
 * @param {MergeOptions} options 
 */
export async function mergeImages(images, options = {}) {
    const {
        layout = '2',
        width = 0,
        height = 0,
        bgColor = '#000000',
        mode = 'fit'
    } = options;

    log.info(`Merging ${images.length} images, layout=${layout}, mode=${mode}`);

    let canvas, ctx, outW, outH;

    // --- Layout 3: Mixed (2 Top, 1 Bottom) ---
    // Fixed 3000x3000px
    if (layout === '3') {
        outW = 3000;
        outH = 3000;
        ({ canvas, ctx } = createCanvas(outW, outH));

        // Fill bg
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, outW, outH);

        // Slot 1: Top Left (0,0) -> 1500x1500
        if (images[0]) await drawSmart(ctx, images[0], 0, 0, 1500, 1500, mode, bgColor);

        // Slot 2: Top Right (1500,0) -> 1500x1500
        if (images[1]) await drawSmart(ctx, images[1], 1500, 0, 1500, 1500, mode, bgColor);

        // Slot 3: Bottom (0,1500) -> 3000x1500
        if (images[2]) await drawSmart(ctx, images[2], 0, 1500, 3000, 1500, mode, bgColor);

    }
    // --- Layout 4: Grid (2x2) ---
    // Fixed 3000x3000px
    else if (layout === '4') {
        outW = 3000;
        outH = 3000;
        ({ canvas, ctx } = createCanvas(outW, outH));

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, outW, outH);

        // Grid 1500x1500 each
        if (images[0]) await drawSmart(ctx, images[0], 0, 0, 1500, 1500, mode, bgColor);
        if (images[1]) await drawSmart(ctx, images[1], 1500, 0, 1500, 1500, mode, bgColor);
        if (images[2]) await drawSmart(ctx, images[2], 0, 1500, 1500, 1500, mode, bgColor);
        if (images[3]) await drawSmart(ctx, images[3], 1500, 1500, 1500, 1500, mode, bgColor);
    }
    // --- Layout 2: Split (Original) ---
    else {
        // Use first two images
        const leftImg = images[0];
        const rightImg = images[1];

        if (!leftImg || !rightImg) {
            throw new Error('Layout 2 requires at least 2 images');
        }

        const lw = leftImg.naturalWidth || leftImg.width;
        const lh = leftImg.naturalHeight || leftImg.height;
        const rw = rightImg.naturalWidth || rightImg.width;
        const rh = rightImg.naturalHeight || rightImg.height;

        // Calculate dimensions
        if (width > 0 && height > 0) {
            outW = width;
            outH = height;
        } else if (width > 0) {
            // ... (width only logic simplified for async refactor, sticking to robust flow)
            // Recalculating strict width logic from previous version to be safe
            const targetHalfW = width / 2;
            const leftScale = targetHalfW / lw;
            const rightScale = targetHalfW / rw;
            outH = Math.round(Math.max(lh * leftScale, rh * rightScale));
            outW = width;
        } else if (height > 0) {
            const leftScale = height / lh;
            const rightScale = height / rh;
            outW = Math.round(lw * leftScale + rw * rightScale);
            outH = height;
        } else {
            const targetH = Math.max(lh, rh);
            const leftScale = targetH / lh;
            const rightScale = targetH / rh;
            outW = Math.round(lw * leftScale) + Math.round(rw * rightScale);
            outH = targetH;
        }

        ({ canvas, ctx } = createCanvas(outW, outH));

        // Fill bg
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, outW, outH);

        const halfW = Math.round(outW / 2);

        // Draw Left
        await drawSmart(ctx, leftImg, 0, 0, halfW, outH, mode, bgColor);
        // Draw Right
        await drawSmart(ctx, rightImg, halfW, 0, outW - halfW, outH, mode, bgColor);
    }

    log.info('Merge complete');
    return { canvas, width: outW, height: outH };
}

export function exportAs(canvas, format = 'png', quality = 0.92) {
    const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`;
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('Canvas export failed')),
            mimeType,
            quality
        );
    });
}

export function getImageInfo(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return { width: w, height: h, aspectRatio: w / h };
}
