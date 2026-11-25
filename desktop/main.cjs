const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:3000';
let server, win, stopping = false, failure = '';
function ready() { return new Promise(resolve => { const r = http.get(url + '/api/desktop-health', res => { let body = ''; res.on('data', x => body += x); res.on('end', () => resolve(res.statusCode === 200 && body === 'sportclub-ready')); }); r.on('error', () => resolve(false)); r.setTimeout(800, () => r.destroy()); }); }
async function launch() {
    if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html')))
        throw new Error('Сначала выполните setup-desktop.bat');
    if (!(await ready())) {
        server = spawn('node', [path.join(root, 'server', 'index.js')], { cwd: path.join(root, 'server'), windowsHide: true, env: { ...process.env, PORT: '3000' }, stdio: ['ignore', 'pipe', 'pipe'] });
        server.stdout.resume();
        server.stderr.on('data', d => failure = (failure + d).slice(-2000));
        server.on('error', e => failure = e.message);
        server.on('exit', code => {
            if (!stopping && win)
                dialog.showErrorBox('SportClub', 'Сервер остановился: ' + code);
        });
        for (let i = 0; i < 60 && !(await ready()); i++) {
            if (failure && server.exitCode !== null)
                break;
            await new Promise(r => setTimeout(r, 250));
        }
        if (!(await ready()))
            throw new Error('Не удалось запустить сервер. ' + failure);
    }
    win = new BrowserWindow({ width: 1280, height: 820, minWidth: 850, minHeight: 600, title: 'SportClub', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, target) => {
        if (new URL(target).origin !== url)
            event.preventDefault();
    });
    await win.loadURL(url);
}
if (!app.requestSingleInstanceLock())
    app.quit();
else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
    app.whenReady().then(launch).catch(e => { dialog.showErrorBox('SportClub', e.message); app.quit(); });
    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', () => {
        stopping = true; if (server)
            server.kill();
    });
}
