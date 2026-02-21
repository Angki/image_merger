/**
 * Preload Script — Secure bridge between Electron main process and renderer.
 * 
 * Exposes a limited API via contextBridge so the renderer can:
 *  - Save files via native dialog
 *  - Copy images to native clipboard
 *  - Open file picker dialog
 *  - Choose output directory for batch
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Save a blob/buffer to disk with native save dialog.
     * @param {ArrayBuffer} buffer - Image data
     * @param {string} defaultName - Default filename
     * @param {'png'|'jpg'|'webp'} format - Image format
     * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
     */
    saveFile: (buffer, defaultName, format) => {
        return ipcRenderer.invoke('save-file', { buffer, defaultName, format });
    },

    /**
     * Copy image to system clipboard as native image.
     * @param {string} dataURL - Image as data URL
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    copyToClipboard: (dataURL) => {
        return ipcRenderer.invoke('copy-to-clipboard', { dataURL });
    },

    /**
     * Open native file picker dialog.
     * @param {boolean} multi - Allow multiple file selection
     * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
     */
    openFileDialog: (multi = false) => {
        return ipcRenderer.invoke('open-file-dialog', { multi });
    },

    /**
     * Save file directly to a path (for batch operations).
     * @param {ArrayBuffer} buffer
     * @param {string} filePath
     * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
     */
    saveFileDirect: (buffer, filePath) => {
        return ipcRenderer.invoke('save-file-direct', { buffer, filePath });
    },

    /**
     * Choose output directory for batch save.
     * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
     */
    chooseDirectory: () => {
        return ipcRenderer.invoke('choose-directory');
    },

    /** Check if running in Electron */
    isElectron: true,
});
