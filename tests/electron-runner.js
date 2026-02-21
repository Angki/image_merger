const { app, BrowserWindow } = require('electron');
const path = require('path');

if (process.env.ELECTRON_RUN_AS_NODE) {
    console.error('ERROR: ELECTRON_RUN_AS_NODE is set. This script must run as Electron app.');
    process.exit(1);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    win.webContents.on('console-message', (event, level, message) => {
        console.log(`[Renderer] ${message}`);
    });

    const testUrl = 'file://' + path.join(__dirname, 'imageProcessor.test.html');
    console.log(`Loading tests from: ${testUrl}`);
    await win.loadURL(testUrl);

    // Poll for results
    const checkResults = async () => {
        try {
            const summary = await win.webContents.executeJavaScript(`
                document.getElementById('summary').textContent
            `);

            if (summary) {
                console.log('Test Summary:', summary);

                const passed = await win.webContents.executeJavaScript(`
                    Array.from(document.querySelectorAll('.pass')).map(el => el.textContent.trim())
                `);

                const failed = await win.webContents.executeJavaScript(`
                    Array.from(document.querySelectorAll('.fail')).map(el => el.textContent.trim())
                `);

                if (passed.length > 0) {
                    console.log('\n✅ PASSED TESTS:');
                    passed.forEach(p => console.log(p));
                }

                if (failed.length > 0) {
                    console.log('\n❌ FAILED TESTS:');
                    failed.forEach(f => console.log(f));
                    console.log('\n❌ QA FAILED');
                    app.exit(1);
                } else {
                    console.log('\n✨ QA PASSED');
                    app.exit(0);
                }
            } else {
                setTimeout(checkResults, 100);
            }
        } catch (err) {
            console.error('Error checking results:', err);
            app.exit(1);
        }
    };

    checkResults();
});
