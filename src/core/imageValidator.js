/**
 * ImageValidator — Validates image files before processing.
 * 
 * Checks:
 *  - MIME type must be image/png, image/jpeg, or image/webp
 *  - Dimensions must not exceed safety limits
 */

import { Logger } from './logger.js';

const log = new Logger('ImageValidator');

/** Accepted MIME types */
const VALID_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Accepted file extensions (fallback check) */
const VALID_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** Maximum dimension per axis (px) */
const MAX_DIMENSION = 20000;

/** Maximum file size in bytes (100 MB) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Validate an image File object.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFile(file) {
    if (!file) {
        return { valid: false, error: 'No file provided.' };
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        log.warn(`File too large: ${sizeMB} MB`, file.name);
        return { valid: false, error: `File is too large (${sizeMB} MB). Maximum is 100 MB.` };
    }

    // Check MIME type
    if (file.type && !VALID_TYPES.has(file.type)) {
        log.warn(`Invalid MIME type: ${file.type}`, file.name);
        return { valid: false, error: `Unsupported format "${file.type}". Use PNG, JPG, or WEBP.` };
    }

    // Fallback: check extension if MIME is missing
    if (!file.type) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!VALID_EXTENSIONS.has(ext)) {
            log.warn(`Invalid extension: .${ext}`, file.name);
            return { valid: false, error: `Unsupported format ".${ext}". Use PNG, JPG, or WEBP.` };
        }
    }

    log.debug(`File validated: ${file.name} (${file.type}, ${file.size} bytes)`);
    return { valid: true };
}

/**
 * Validate image dimensions.
 * @param {number} width
 * @param {number} height
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDimensions(width, height) {
    if (!width || !height || width <= 0 || height <= 0) {
        return { valid: false, error: 'Invalid image dimensions.' };
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        return { valid: false, error: `Image too large (${width}×${height}). Max ${MAX_DIMENSION}px per side.` };
    }
    return { valid: true };
}

/**
 * Validate a File from clipboard or drag event.
 * @param {DataTransferItem|File} item
 * @returns {{ valid: boolean, error?: string, file?: File }}
 */
export function validateClipboardItem(item) {
    let file;
    if (item instanceof File) {
        file = item;
    } else if (item.getAsFile) {
        file = item.getAsFile();
    }
    if (!file) {
        return { valid: false, error: 'Could not read image from clipboard.' };
    }
    const result = validateFile(file);
    return result.valid ? { valid: true, file } : result;
}
