/**
 * Art Split Merger — Electron Main Process
 * 
 * Creates the application window and handles IPC for:
 *  - Native file save dialogs
 *  - Native clipboard write (image)
 *  - Native file open dialogs
 */

const electron = require('electron');

// Guard: ensure we are running inside Electron, not plain Node.js
if (typeof electron === 'string' || !electron.app) {
    console.error('ERROR: main.js must be run via the Electron runtime, not plain Node.js.');
    console.error('Use: npx electron .   or   npm start');
    console.error('Make sure "electron" resolves to the Electron binary, not the npm wrapper.');
    process.exit(1);
}

const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage } = electron;
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 820,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#0d0d0d',
        title: 'Art Split Merger',
        icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        // Frameless look with native title bar
        titleBarStyle: 'default',
        autoHideMenuBar: true,
    });

    mainWindow.loadFile('index.html');

    // Open DevTools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ─── App Lifecycle ───────────────────────────────────────────────────

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    app.quit();
});

// ─── IPC Handlers ────────────────────────────────────────────────────

/**
 * Save file with native dialog.
 * Receives: { buffer: ArrayBuffer, defaultName: string, format: 'png'|'jpg' }
 * Returns: { success: boolean, filePath?: string, error?: string }
 */
ipcMain.handle('save-file', async (event, { buffer, defaultName, format }) => {
    try {
        const filters = format === 'jpg'
            ? [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
            : format === 'webp'
                ? [{ name: 'WebP Image', extensions: ['webp'] }]
                : [{ name: 'PNG Image', extensions: ['png'] }];

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Merged Image',
            defaultPath: defaultName,
            filters: [
                ...filters,
                { name: 'All Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
            ],
        });

        if (canceled || !filePath) {
            return { success: false, error: 'Save cancelled' };
        }

        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * Copy image to native clipboard.
 * Receives: { dataURL: string }
 * Returns: { success: boolean, error?: string }
 */
ipcMain.handle('copy-to-clipboard', async (event, { dataURL }) => {
    try {
        const img = nativeImage.createFromDataURL(dataURL);
        clipboard.writeImage(img);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * Open file dialog for image selection.
 * Receives: { multi: boolean }
 * Returns: { canceled: boolean, filePaths: string[] }
 */
ipcMain.handle('open-file-dialog', async (event, { multi = false } = {}) => {
    const properties = ['openFile'];
    if (multi) properties.push('multiSelections');

    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Image',
        filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        ],
        properties,
    });

    return result;
});

/**
 * Save batch file — saves directly without dialog prompt per file.
 * Receives: { buffer: ArrayBuffer, filePath: string }
 */
ipcMain.handle('save-file-direct', async (event, { buffer, filePath }) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

/**
 * Choose directory for batch output.
 */
ipcMain.handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Output Directory',
        properties: ['openDirectory', 'createDirectory'],
    });
    return result;
});
