const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const electron = require('electron');
const { app, session, Menu, MenuItem, BrowserWindow, ipcMain, shell, screen } = electron;

const baseDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FACEIT');
const extensionsDir = path.join(baseDir, 'extensions');
const logFile = path.join(extensionsDir, 'loader.log');
const configFile = path.join(extensionsDir, 'config.json');

if (!fs.existsSync(extensionsDir)) {
    try {
        fs.mkdirSync(extensionsDir, { recursive: true });
    } catch (_) {}
}

let clientConfig = { performanceMode: true, zoomFactor: 0.95 };
if (fs.existsSync(configFile)) {
    try {
        clientConfig = { ...clientConfig, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
    } catch (_) {}
} else {
    try {
        fs.writeFileSync(configFile, JSON.stringify(clientConfig, null, 2), 'utf8');
    } catch (_) {}
}

function writeLog(...args) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ` + args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ') + '\n';
    try {
        fs.appendFileSync(logFile, entry, 'utf8');
    } catch (_) {}
}

function saveConfig(updated) {
    clientConfig = { ...clientConfig, ...updated };
    try {
        fs.writeFileSync(configFile, JSON.stringify(clientConfig, null, 2), 'utf8');
    } catch (_) {}
}

const CURRENT_VERSION = '1.0.3';
const UPDATE_REPO = 'sheistyszn/betterfaceit';
const UPDATE_VERSION_URL = 'https://raw.githubusercontent.com/sheistyszn/betterfaceit/main/version.json';
const UPDATE_ZIP_URL = 'https://github.com/sheistyszn/betterfaceit/archive/refs/heads/main.zip';

function fetchUrl(targetUrl, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) return reject(new Error('Too many redirects'));
        const client = targetUrl.startsWith('https:') ? https : http;
        client.get(targetUrl, { headers: { 'User-Agent': 'BetterFACEIT-AutoUpdater/1.0' } }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                const redirectTarget = new URL(res.headers.location, targetUrl).toString();
                return resolve(fetchUrl(redirectTarget, maxRedirects - 1));
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function downloadFile(targetUrl, destPath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) return reject(new Error('Too many redirects'));
        const client = targetUrl.startsWith('https:') ? https : http;
        client.get(targetUrl, { headers: { 'User-Agent': 'BetterFACEIT-AutoUpdater/1.0' } }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                const redirectTarget = new URL(res.headers.location, targetUrl).toString();
                return resolve(downloadFile(redirectTarget, destPath, maxRedirects - 1));
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve(destPath);
            });
            fileStream.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', reject);
    });
}

function compareSemver(remote, local) {
    const r = (remote || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const l = (local || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const rv = r[i] || 0;
        const lv = l[i] || 0;
        if (rv > lv) return 1;
        if (rv < lv) return -1;
    }
    return 0;
}

function copyDirRecursive(src, dest, ignore = []) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        if (ignore.includes(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath, ignore);
        } else {
            try {
                fs.copyFileSync(srcPath, destPath);
            } catch (_) {}
        }
    }
}

let updateStatus = { checking: false, updateAvailable: false, latestVersion: CURRENT_VERSION, downloading: false };

function cleanOutdatedVersions() {
    try {
        if (!fs.existsSync(baseDir)) return;
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        const appDirs = entries
            .filter(e => e.isDirectory() && /^app-\d/.test(e.name))
            .map(e => ({ name: e.name, path: path.join(baseDir, e.name) }))
            .sort((a, b) => {
                const verA = a.name.replace(/^app-/, '');
                const verB = b.name.replace(/^app-/, '');
                return compareSemver(verB, verA);
            });

        if (appDirs.length > 1) {
            for (let i = 1; i < appDirs.length; i++) {
                const old = appDirs[i];
                if (!__dirname.toLowerCase().startsWith(old.path.toLowerCase())) {
                    writeLog(`[Cleanup] Removing outdated, unusable FACEIT version: ${old.name}`);
                    try {
                        fs.rmSync(old.path, { recursive: true, force: true });
                        writeLog(`[Cleanup] Successfully removed ${old.name}`);
                    } catch (err) {
                        writeLog(`[Cleanup] Could not remove ${old.name}:`, err.message);
                    }
                }
            }
        }
    } catch (err) {
        writeLog('[Cleanup] Error checking old versions:', err.message);
    }
}

async function safeRelaunchClient(reason = 'update') {
    cleanOutdatedVersions();
    writeLog(`[Client] Relaunching FACEIT client now (${reason})...`);
    setTimeout(() => {
        app.relaunch();
        app.exit(0);
    }, 1200);
    return { success: true };
}

async function checkForUpdates(silent = false) {
    if (updateStatus.checking || updateStatus.downloading) return updateStatus;
    updateStatus.checking = true;
    try {
        const rawJson = await fetchUrl(UPDATE_VERSION_URL);
        const remoteData = JSON.parse(rawJson);
        const latestVersion = remoteData.version || CURRENT_VERSION;
        const isNewer = compareSemver(latestVersion, CURRENT_VERSION) > 0;
        updateStatus = {
            checking: false,
            updateAvailable: isNewer,
            currentVersion: CURRENT_VERSION,
            latestVersion: latestVersion,
            downloading: false,
            waitingForGame: false,
            changelog: remoteData.changelog || ''
        };
        writeLog(`[AutoUpdate] Update check complete. Current: v${CURRENT_VERSION}, Latest: v${latestVersion}, Update available: ${isNewer}`);
        if (isNewer) {
            broadcastUpdateAvailable(updateStatus);
            if (silent) {
                writeLog('[AutoUpdate] Background check found new version. Downloading and applying update in background...');
                downloadAndApplyUpdate().catch(err => {
                    writeLog('[AutoUpdate] Background auto-update error:', err.message || err);
                });
            }
        }
        return updateStatus;
    } catch (err) {
        updateStatus.checking = false;
        writeLog('[AutoUpdate] Check failed:', err.message || err);
        return { checking: false, updateAvailable: false, currentVersion: CURRENT_VERSION, latestVersion: CURRENT_VERSION, error: err.message };
    }
}

function broadcastUpdateAvailable(info) {
    if (managerWindow && !managerWindow.isDestroyed()) {
        try {
            managerWindow.webContents.send('update-available', info);
        } catch (_) {}
    }
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win !== managerWindow) {
            try {
                win.webContents.executeJavaScript(`
                    (function() {
                        if (document.getElementById('faceit-update-toast')) return;
                        const toast = document.createElement('div');
                        toast.id = 'faceit-update-toast';
                        toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999999;background:#18191d;color:#fff;border:1px solid #ff5500;border-radius:24px;padding:8px 18px;font-family:Segoe UI,sans-serif;font-size:12px;font-weight:700;display:flex;align-items:center;gap:12px;box-shadow:0 6px 20px rgba(0,0,0,0.7);cursor:pointer;user-select:none;transition:all 0.2s ease;';
                        toast.innerHTML = '<span style="color:#ff5500;">🚀 BetterFACEIT v${info.latestVersion} Available!</span> <span style="background:#ff5500;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;">Update & Relaunch</span>';
                        toast.onclick = function() {
                            toast.innerHTML = '<span style="color:#ff5500;">⏳ Downloading BetterFACEIT & extensions update...</span>';
                            console.log('__TRIGGER_UPDATE__');
                        };
                        document.body.appendChild(toast);
                    })();
                `).catch(() => {});
            } catch (_) {}
        }
    }
}

function broadcastUpdateStatus(info) {
    if (managerWindow && !managerWindow.isDestroyed()) {
        try {
            managerWindow.webContents.send('update-status', info);
        } catch (_) {}
    }
}

async function downloadAndApplyUpdate() {
    if (updateStatus.downloading) return { success: false, error: 'Update is already downloading' };
    updateStatus.downloading = true;
    writeLog('[AutoUpdate] Starting download from GitHub:', UPDATE_ZIP_URL);

    const tempDir = path.join(os.tmpdir(), 'betterfaceit_update_' + Date.now());
    const zipPath = path.join(os.tmpdir(), 'betterfaceit_update.zip');

    try {
        fs.mkdirSync(tempDir, { recursive: true });
        await downloadFile(UPDATE_ZIP_URL, zipPath);
        writeLog('[AutoUpdate] Download complete. Extracting archive...');

        await new Promise((resolve, reject) => {
            const extractCmd = `Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force`;
            execFile('powershell.exe', ['-NoProfile', '-Command', extractCmd], (err, stdout, stderr) => {
                if (err) return reject(new Error(stderr || err.message));
                resolve();
            });
        });

        const entries = fs.readdirSync(tempDir);
        let extractedRoot = tempDir;
        for (const entry of entries) {
            const full = path.join(tempDir, entry);
            if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'src'))) {
                extractedRoot = full;
                break;
            }
        }

        writeLog('[AutoUpdate] Archive extracted to:', extractedRoot);

        // 1. Update runtime resources in current client (resources directory)
        const currentResourcesDir = __dirname;
        const extractedSrc = path.join(extractedRoot, 'src');
        if (fs.existsSync(extractedSrc)) {
            const runtimeFiles = ['extensionLoader.js', 'extensionsManager.html', 'managerPreload.js', 'patcher.js', 'version.json'];
            for (const file of runtimeFiles) {
                const srcPath = path.join(extractedSrc, file);
                const destPath = path.join(currentResourcesDir, file);
                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }

        // 2. Update Install-Extension.ps1 in extensions dir
        const srcInstallScript = path.join(extractedSrc, 'Install-Extension.ps1');
        if (fs.existsSync(srcInstallScript)) {
            fs.copyFileSync(srcInstallScript, path.join(extensionsDir, 'Install-Extension.ps1'));
        }

        // 3. Update version.json in extensionsDir and resources
        const srcVersionJson = path.join(extractedRoot, 'version.json');
        if (fs.existsSync(srcVersionJson)) {
            fs.copyFileSync(srcVersionJson, path.join(extensionsDir, 'version.json'));
            fs.copyFileSync(srcVersionJson, path.join(currentResourcesDir, 'version.json'));
        }

        // 4. Update all bundled extensions (Repeek, Faceit UI Cleaner, VisusGG)
        const extractedExts = path.join(extractedRoot, 'extensions');
        if (fs.existsSync(extractedExts)) {
            copyDirRecursive(extractedExts, extensionsDir);
            writeLog('[AutoUpdate] Bundled extensions synchronized and updated.');
        }

        // 5. Update local repo if it exists
        const repoFolder = fs.existsSync(path.join(baseDir, 'BetterFACEIT'))
            ? path.join(baseDir, 'BetterFACEIT')
            : path.join(baseDir, 'BetterFaceit');
        if (fs.existsSync(repoFolder)) {
            try {
                copyDirRecursive(extractedRoot, repoFolder, ['.git']);
                writeLog('[AutoUpdate] Local repository files updated at:', repoFolder);
            } catch (_) {}
        }

        // Clean up temporary files
        try {
            fs.unlinkSync(zipPath);
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}

        updateStatus.downloading = false;
        writeLog('[AutoUpdate] Update applied successfully! Relaunching client...');

        await safeRelaunchClient('update');
        return { success: true };
    } catch (err) {
        updateStatus.downloading = false;
        writeLog('[AutoUpdate] Failed to apply update:', err.message || err);
        return { success: false, error: err.message };
    }
}

if (clientConfig.performanceMode) {
    app.disableHardwareAcceleration = function() {
        writeLog('[Performance] Preserved GPU hardware acceleration');
    };
    try {
        app.commandLine.appendSwitch('enable-gpu-rasterization');
        app.commandLine.appendSwitch('ignore-gpu-blocklist');
    } catch (_) {}
}

const registry = {
    byId: new Map(),
    byName: new Map()
};

const normalizedDirs = new Set();
function normalizeExtensionFiles(extDir) {
    if (normalizedDirs.has(extDir)) return;
    normalizedDirs.add(extDir);

    const metaDir = path.join(extDir, '_metadata');
    if (fs.existsSync(metaDir)) {
        try {
            fs.rmSync(metaDir, { recursive: true, force: true });
        } catch (_) {}
    }

    try {
        const scan = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    let content = fs.readFileSync(fullPath, 'utf8');
                    let modified = false;
                    if (content.includes('storageType:o="sync"')) {
                        content = content.replace(/storageType:o="sync"/g, 'storageType:o="local"');
                        modified = true;
                    }
                    if (content.includes('storageType:a="sync"')) {
                        content = content.replace(/storageType:a="sync"/g, 'storageType:a="local"');
                        modified = true;
                    }
                    if (content.includes('storageType:n="sync"')) {
                        content = content.replace(/storageType:n="sync"/g, 'storageType:n="local"');
                        modified = true;
                    }
                    if (modified) {
                        fs.writeFileSync(fullPath, content, 'utf8');
                    }
                }
            }
        };
        scan(extDir);

        const optionsHtml = path.join(extDir, 'options', 'index.html');
        const popupHtml = path.join(extDir, 'popup', 'index.html');
        if (fs.existsSync(optionsHtml) && fs.existsSync(popupHtml)) {
            const htmlContent = fs.readFileSync(optionsHtml, 'utf8');
            if (!htmlContent.includes('window.location.replace')) {
                fs.writeFileSync(optionsHtml, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Settings</title><script>window.location.replace("../popup/index.html");</script></head><body style="background:#121316;color:#fff;"></body></html>', 'utf8');
            }
        }
    } catch (err) {
        writeLog('Error normalizing extension files:', err.message);
    }
}

const loadedSessionExtensions = new WeakMap();

async function loadExtensionInSession(ses, extDir) {
    const manifestPath = path.join(extDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    let loaded = loadedSessionExtensions.get(ses);
    if (!loaded) {
        loaded = new Set();
        loadedSessionExtensions.set(ses, loaded);
    }
    const folder = path.basename(extDir);
    if (loaded.has(folder)) {
        return null;
    }

    if (typeof ses.getAllExtensions === 'function') {
        try {
            const existing = ses.getAllExtensions();
            if (existing && existing.some(e => e.path === extDir)) {
                loaded.add(folder);
                return null;
            }
        } catch (_) {}
    }

    normalizeExtensionFiles(extDir);

    try {
        const ext = await ses.loadExtension(extDir, { allowFileAccess: true });
        loaded.add(folder);
        const record = { ...ext, folder };
        registry.byId.set(ext.id, record);
        registry.byName.set(ext.name, record);
        writeLog(`Loaded extension: "${ext.name}" (${ext.version}) [${ext.id}]`);
        return ext;
    } catch (err) {
        writeLog(`Failed to load extension at ${extDir}:`, err.message || err);
        return null;
    }
}

function isExtensionEnabled(folder) {
    if (!Array.isArray(clientConfig.disabledExtensions)) return true;
    return !clientConfig.disabledExtensions.includes(folder);
}

async function loadAllExtensions(ses) {
    if (!ses || typeof ses.loadExtension !== 'function') return;
    if (typeof ses.isPersistent === 'function' && !ses.isPersistent()) return;
    if (!fs.existsSync(extensionsDir)) return;

    try {
        const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!isExtensionEnabled(entry.name)) {
                    writeLog(`Extension "${entry.name}" is disabled in configuration. Skipping load.`);
                    continue;
                }
                await loadExtensionInSession(ses, path.join(extensionsDir, entry.name));
            }
        }
    } catch (err) {
        writeLog('Error reading extensions directory:', err.message || err);
    }
}

function getExtensionMetadata(extDir) {
    const manifestPath = path.join(extDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const optionsPage = manifest.options_ui?.page || manifest.options_page || null;
        const popupPage = manifest.action?.default_popup || manifest.browser_action?.default_popup || null;

        let iconDataUrl = null;
        const candidates = [];
        if (manifest.icons) {
            for (const size of ['128', '64', '48', '32', '16']) {
                if (manifest.icons[size]) candidates.push(manifest.icons[size]);
            }
        }
        if (manifest.action?.default_icon) {
            if (typeof manifest.action.default_icon === 'string') {
                candidates.push(manifest.action.default_icon);
            } else if (typeof manifest.action.default_icon === 'object') {
                Object.values(manifest.action.default_icon).forEach(p => candidates.push(p));
            }
        }

        for (const rel of candidates) {
            const abs = path.join(extDir, rel);
            if (fs.existsSync(abs)) {
                try {
                    const extname = path.extname(abs).toLowerCase().replace('.', '');
                    const mime = extname === 'svg' ? 'image/svg+xml' : `image/${extname}`;
                    const buffer = fs.readFileSync(abs);
                    iconDataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
                    break;
                } catch (_) {}
            }
        }

        return {
            manifest,
            optionsPage,
            popupPage,
            iconDataUrl
        };
    } catch (_) {
        return null;
    }
}

function calculateAdaptiveBounds(isPopup) {
    const primary = screen.getPrimaryDisplay();
    const { width: availWidth, height: availHeight } = primary.workAreaSize;

    let targetWidth;
    let targetHeight;

    if (isPopup) {
        targetWidth = Math.min(760, Math.max(500, Math.round(availWidth * 0.45)));
        targetHeight = Math.min(580, Math.max(520, Math.round(availHeight * 0.65)));
    } else {
        targetWidth = Math.min(840, Math.max(680, Math.round(availWidth * 0.55)));
        targetHeight = Math.min(620, Math.max(540, Math.round(availHeight * 0.70)));
    }

    return {
        width: targetWidth,
        height: targetHeight,
        minWidth: 480,
        minHeight: 460
    };
}

function openExtensionPage(extId, pageType) {
    try {
        const ext = registry.byId.get(extId);
        if (!ext) {
            writeLog(`Extension with id ${extId} not found in registry`);
            return;
        }

        const extDir = path.join(extensionsDir, ext.folder);
        const meta = getExtensionMetadata(extDir);
        if (!meta) return;

        let targetRel = null;
        let isPopup = false;

        if (ext.name.toLowerCase().includes('repeek')) {
            targetRel = 'popup/index.html';
            isPopup = true;
        } else if (pageType === 'popup') {
            targetRel = meta.popupPage || meta.optionsPage;
            isPopup = true;
        } else {
            targetRel = meta.optionsPage || meta.popupPage;
            isPopup = !meta.optionsPage;
        }

        if (!targetRel) {
            writeLog(`No settings or popup page available for ${ext.name}`);
            return;
        }

        const targetUrl = `chrome-extension://${ext.id}/${targetRel}`;
        const bounds = calculateAdaptiveBounds(isPopup);

        const win = new BrowserWindow({
            width: bounds.width,
            height: bounds.height,
            minWidth: bounds.minWidth,
            minHeight: bounds.minHeight,
            center: true,
            title: `${ext.name} - Settings`,
            autoHideMenuBar: true,
            backgroundColor: '#121316',
            show: false,
            webPreferences: {
                session: session.defaultSession,
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        win.once('ready-to-show', () => {
            win.show();
        });

        win.loadURL(targetUrl);
    } catch (err) {
        writeLog('Error displaying extension page:', err.message || err);
    }
}

let managerWindow = null;
function openExtensionsManager() {
    if (managerWindow && !managerWindow.isDestroyed()) {
        managerWindow.focus();
        return;
    }

    const htmlPath = path.join(__dirname, 'extensionsManager.html');
    const preloadPath = path.join(__dirname, 'managerPreload.js');

    const primary = screen.getPrimaryDisplay();
    const { width: availWidth, height: availHeight } = primary.workAreaSize;

    const managerWidth = Math.min(960, Math.max(820, Math.round(availWidth * 0.58)));
    const managerHeight = Math.min(640, Math.max(540, Math.round(availHeight * 0.65)));

    managerWindow = new BrowserWindow({
        width: managerWidth,
        height: managerHeight,
        minWidth: 700,
        minHeight: 480,
        center: true,
        title: 'BetterFACEIT',
        backgroundColor: '#121316',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            session: session.defaultSession,
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    managerWindow.once('ready-to-show', () => {
        managerWindow.show();
    });

    managerWindow.loadFile(htmlPath);
    managerWindow.on('closed', () => {
        managerWindow = null;
    });
}

function updateDockZoomText(wc, factor) {
    try {
        const percent = Math.round(factor * 100) + '%';
        wc.executeJavaScript(`
            (function() {
                const el = document.getElementById('faceit-zoom-dock-val');
                if (el) el.textContent = '${percent}';
            })();
        `).catch(() => {});
    } catch (_) {}
}

function adjustZoom(wc, delta) {
    try {
        const current = wc.getZoomFactor();
        let target;
        if (delta === 0) {
            target = 1.0;
        } else {
            target = Math.min(1.8, Math.max(0.6, Math.round((current + delta) * 100) / 100));
        }
        wc.setZoomFactor(target);
        saveConfig({ zoomFactor: target });
        showZoomToast(wc, target);
        updateDockZoomText(wc, target);
        return target;
    } catch (_) {
        return 1.0;
    }
}

function showZoomToast(wc, factor) {
    try {
        const percent = Math.round(factor * 100);
        wc.executeJavaScript(`
            (function() {
                let toast = document.getElementById('faceit-zoom-toast');
                if (!toast) {
                    toast = document.createElement('div');
                    toast.id = 'faceit-zoom-toast';
                    toast.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999999;background:rgba(20,22,28,0.92);color:#ff5500;border:1px solid #ff5500;border-radius:12px;padding:6px 14px;font-family:Segoe UI,sans-serif;font-size:12px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,0.6);transition:opacity 0.25s ease;pointer-events:none;';
                    document.body.appendChild(toast);
                }
                toast.textContent = 'Zoom: ${percent}%';
                toast.style.opacity = '1';
                clearTimeout(window.__zoomTimer);
                window.__zoomTimer = setTimeout(function() { toast.style.opacity = '0'; }, 1100);
            })();
        `).catch(() => {});
    } catch (_) {}
}

ipcMain.handle('get-config', async () => clientConfig);
ipcMain.handle('set-config', async (_, newConfig) => {
    saveConfig(newConfig);
    writeLog('Updated client configuration:', JSON.stringify(clientConfig));
    if (!clientConfig.performanceMode) {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed() && win !== managerWindow) {
                try {
                    win.webContents.setBackgroundThrottling(false);
                    win.webContents.setFrameRate(60);
                } catch (_) {}
            }
        }
    }
    return clientConfig;
});

ipcMain.handle('set-zoom', async (_, delta) => {
    let target = typeof clientConfig.zoomFactor === 'number' ? clientConfig.zoomFactor : 0.95;
    if (delta === 0) {
        target = 1.0;
    } else {
        target = Math.min(1.8, Math.max(0.6, Math.round((target + delta) * 100) / 100));
    }
    saveConfig({ zoomFactor: target });
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win !== managerWindow) {
            try {
                win.webContents.setZoomFactor(target);
                showZoomToast(win.webContents, target);
                updateDockZoomText(win.webContents, target);
            } catch (_) {}
        }
    }
    return target;
});

ipcMain.handle('reset-zoom', async () => {
    const target = 1.0;
    saveConfig({ zoomFactor: target });
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win !== managerWindow) {
            try {
                win.webContents.setZoomFactor(target);
                showZoomToast(win.webContents, target);
                updateDockZoomText(win.webContents, target);
            } catch (_) {}
        }
    }
    return target;
});

ipcMain.handle('get-extensions', async () => {
    const list = [];
    if (!fs.existsSync(extensionsDir)) return list;

    try {
        const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const extPath = path.join(extensionsDir, entry.name);
                const meta = getExtensionMetadata(extPath);
                if (meta) {
                    let extId = entry.name;
                    for (const [id, ext] of registry.byId.entries()) {
                        if (ext.folder === entry.name || ext.name === meta.manifest.name) {
                            extId = id;
                            break;
                        }
                    }

                    list.push({
                        id: extId,
                        name: meta.manifest.name || entry.name,
                        version: meta.manifest.version || '1.0.0',
                        description: meta.manifest.description || '',
                        folder: entry.name,
                        enabled: isExtensionEnabled(entry.name),
                        hasOptions: Boolean(meta.optionsPage),
                        hasPopup: Boolean(meta.popupPage),
                        iconDataUrl: meta.iconDataUrl
                    });
                }
            }
        }
    } catch (err) {
        writeLog('IPC get-extensions error:', err.message);
    }
    return list;
});

ipcMain.handle('toggle-extension', async (_, { folder, enabled }) => {
    let disabled = Array.isArray(clientConfig.disabledExtensions) ? [...clientConfig.disabledExtensions] : [];
    if (enabled) {
        disabled = disabled.filter(f => f !== folder);
    } else {
        if (!disabled.includes(folder)) {
            disabled.push(folder);
        }
    }
    saveConfig({ disabledExtensions: disabled });
    writeLog(`Toggled extension "${folder}" -> enabled: ${enabled}`);
    return { success: true, enabled };
});

ipcMain.handle('open-extension-settings', async (_, { id, type }) => {
    openExtensionPage(id, type);
    return true;
});

ipcMain.handle('open-extension-folder', async (_, folder) => {
    const target = path.join(extensionsDir, folder);
    if (fs.existsSync(target)) {
        shell.openPath(target);
    }
    return true;
});

ipcMain.handle('open-extensions-dir', async () => {
    shell.openPath(extensionsDir);
    return true;
});

ipcMain.handle('restart-client', async () => safeRelaunchClient('manual'));

ipcMain.handle('check-for-updates', async () => checkForUpdates(false));
ipcMain.handle('apply-update', async () => downloadAndApplyUpdate());
ipcMain.handle('get-version', async () => ({ currentVersion: CURRENT_VERSION, updateStatus }));

ipcMain.handle('install-extension', async (_, urlOrId) => {
    return new Promise((resolve) => {
        const scriptPath = path.join(extensionsDir, 'Install-Extension.ps1');
        if (!fs.existsSync(scriptPath)) {
            return resolve({ success: false, error: 'Install script not found' });
        }

        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ExtensionIdOrUrl', urlOrId], (err, stdout, stderr) => {
            if (err) {
                return resolve({ success: false, error: stderr || err.message });
            }
            if (stdout && stdout.includes('Successfully installed')) {
                resolve({ success: true, name: 'Extension' });
            } else {
                resolve({ success: false, error: stdout || 'Installation aborted' });
            }
        });
    });
});

app.on('web-contents-created', (_, wc) => {

    wc.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown') {
            if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
                wc.toggleDevTools();
                event.preventDefault();
            } else if (input.control && input.shift && input.key.toLowerCase() === 'e') {
                openExtensionsManager();
                event.preventDefault();
            } else if (input.control && (input.key === '-' || input.key === '_')) {
                adjustZoom(wc, -0.05);
                event.preventDefault();
            } else if (input.control && (input.key === '=' || input.key === '+')) {
                adjustZoom(wc, 0.05);
                event.preventDefault();
            } else if (input.control && input.key === '0') {
                adjustZoom(wc, 0);
                event.preventDefault();
            }
        }
    });

    wc.on('console-message', (_, __, message) => {
        if (message === '__OPEN_EXTENSIONS_MANAGER__') {
            openExtensionsManager();
        } else if (message === '__ZOOM_OUT__') {
            adjustZoom(wc, -0.05);
        } else if (message === '__ZOOM_IN__') {
            adjustZoom(wc, 0.05);
        } else if (message === '__ZOOM_RESET__') {
            adjustZoom(wc, 0);
        } else if (message === '__TRIGGER_UPDATE__') {
            downloadAndApplyUpdate();
        }
    });

    wc.on('did-finish-load', () => {
        try {
            const initialZoom = typeof clientConfig.zoomFactor === 'number' ? clientConfig.zoomFactor : 0.95;
            wc.setZoomFactor(initialZoom);

            const url = wc.getURL();
            if (url && url.includes('faceit.com')) {
                wc.insertCSS(`
                    ::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
                    ::-webkit-scrollbar-track { background: #121316 !important; }
                    ::-webkit-scrollbar-thumb { background: #2e3340 !important; border-radius: 3px !important; }
                    ::-webkit-scrollbar-thumb:hover { background: #ff5500 !important; }
                    * { scrollbar-width: thin !important; scrollbar-color: #2e3340 #121316 !important; }
                `).catch(() => {});

                wc.executeJavaScript(`
                    (function() {
                        if (document.getElementById('faceit-ext-float-dock')) return;

                        const dock = document.createElement('div');
                        dock.id = 'faceit-ext-float-dock';
                        dock.style.cssText = 'position:fixed;bottom:16px;right:68px;z-index:999999;display:flex;align-items:center;gap:6px;background:#18191d;border:1px solid #2e3340;border-radius:18px;padding:6px 13px;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-family:Segoe UI,sans-serif;user-select:none;cursor:pointer;color:#ff5500;font-size:11px;font-weight:700;letter-spacing:0.5px;transition:right 0.25s ease, bottom 0.25s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;';
                        dock.innerHTML = '<span style="font-size:12px;line-height:1;">⚡</span><span>BETTER FACEIT</span>';
                        dock.title = 'BetterFACEIT Settings (Ctrl+Shift+E)';
                        dock.onmouseenter = function() {
                            dock.style.background = '#22252d';
                            dock.style.borderColor = '#ff5500';
                            dock.style.boxShadow = '0 4px 20px rgba(255,85,0,0.25)';
                        };
                        dock.onmouseleave = function() {
                            dock.style.background = '#18191d';
                            dock.style.borderColor = '#2e3340';
                            dock.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)';
                        };
                        dock.onclick = function() { console.log('__OPEN_EXTENSIONS_MANAGER__'); };
                        document.body.appendChild(dock);

                        const findRepeekBtn = () => {
                            let btn = document.querySelector('button[class*="right-2.5"][class*="bottom-2"], [class*="right-2.5"][class*="bottom-2"]');
                            if (btn && btn.offsetParent !== null) return btn;
                            const hosts = document.querySelectorAll('*');
                            for (let i = 0; i < hosts.length; i++) {
                                const sr = hosts[i].shadowRoot;
                                if (sr) {
                                    btn = sr.querySelector('button[class*="right-2.5"][class*="bottom-2"], [class*="right-2.5"][class*="bottom-2"]');
                                    if (btn && btn.offsetParent !== null) return btn;
                                }
                            }
                            return null;
                        };

                        const updateDockPos = () => {
                            const repeekBtn = findRepeekBtn();
                            if (repeekBtn && window.getComputedStyle(repeekBtn).display !== 'none') {
                                const rect = repeekBtn.getBoundingClientRect();
                                const distFromRight = Math.round(window.innerWidth - rect.left + 10);
                                const repeekCenterBottom = window.innerHeight - (rect.top + rect.height / 2);
                                const dockHeight = dock.offsetHeight || 28;
                                const distFromBottom = Math.round(repeekCenterBottom - dockHeight / 2);
                                dock.style.right = distFromRight + 'px';
                                dock.style.bottom = distFromBottom + 'px';
                            } else {
                                dock.style.right = '68px';
                                dock.style.bottom = '16px';
                            }
                        };
                        updateDockPos();
                        setTimeout(updateDockPos, 400);
                        setTimeout(updateDockPos, 1200);
                        setTimeout(updateDockPos, 2500);
                        const posObserver = new MutationObserver(updateDockPos);
                        posObserver.observe(document.body, { childList: true, subtree: true });
                        window.addEventListener('resize', updateDockPos);
                    })();
                `).catch(() => {});
            }
        } catch (_) {}
    });

    wc.on('context-menu', (_, params) => {
        try {
            const menu = new Menu();

            menu.append(new MenuItem({
                label: '⚡ BetterFACEIT Settings...',
                click: () => openExtensionsManager()
            }));

            if (registry.byId.size > 0) {
                const subMenu = new Menu();
                for (const [id, ext] of registry.byId.entries()) {
                    const extDir = path.join(extensionsDir, ext.folder);
                    const meta = getExtensionMetadata(extDir);
                    if (meta?.optionsPage || meta?.popupPage) {
                        subMenu.append(new MenuItem({
                            label: `⚙️ ${ext.name}`,
                            click: () => openExtensionPage(id, 'options')
                        }));
                    }
                }
                menu.append(new MenuItem({
                    label: 'Extension Settings',
                    submenu: subMenu
                }));
            }

            menu.append(new MenuItem({ type: 'separator' }));

            const zoomMenu = new Menu();
            zoomMenu.append(new MenuItem({
                label: 'Zoom In (Ctrl + +)',
                click: () => adjustZoom(wc, 0.05)
            }));
            zoomMenu.append(new MenuItem({
                label: 'Zoom Out (Ctrl + -)',
                click: () => adjustZoom(wc, -0.05)
            }));
            zoomMenu.append(new MenuItem({
                label: 'Reset Zoom (Ctrl + 0)',
                click: () => adjustZoom(wc, 0)
            }));

            menu.append(new MenuItem({
                label: `Zoom (${Math.round(wc.getZoomFactor() * 100)}%)`,
                submenu: zoomMenu
            }));

            menu.append(new MenuItem({ type: 'separator' }));

            menu.append(new MenuItem({
                label: 'Inspect Element',
                click: () => {
                    wc.inspectElement(params.x, params.y);
                    if (!wc.isDevToolsOpened()) {
                        wc.openDevTools({ mode: 'detach' });
                    }
                }
            }));
            menu.append(new MenuItem({
                label: 'Toggle Developer Tools',
                click: () => {
                    wc.toggleDevTools();
                }
            }));

            menu.append(new MenuItem({ type: 'separator' }));

            menu.append(new MenuItem({
                label: 'Reload',
                click: () => {
                    wc.reload();
                }
            }));

            menu.popup();
        } catch (err) {
            writeLog('Context menu render error:', err.message || err);
        }
    });
});

app.on('will-quit', () => writeLog('[Lifecycle] app will-quit'));
app.on('before-quit', () => writeLog('[Lifecycle] app before-quit'));
app.on('quit', (_, code) => writeLog(`[Lifecycle] app quit with code ${code}`));
process.on('exit', (code) => writeLog(`[Lifecycle] process exit with code ${code}`));
process.on('uncaughtException', (err) => writeLog(`[Error] uncaughtException: ${err?.stack || err}`));
process.on('unhandledRejection', (reason) => writeLog(`[Error] unhandledRejection: ${reason?.stack || reason}`));

app.on('browser-window-created', (_, win) => {
    writeLog(`[Window] Window created: ${win.id}`);
    win.on('close', () => writeLog(`[Window] Window close: ${win.id}`));
    win.on('closed', () => writeLog(`[Window] Window closed: ${win.id}`));
    win.on('blur', () => {
        if (!clientConfig.performanceMode) return;
        try {
            win.webContents.setBackgroundThrottling(true);
            win.webContents.setFrameRate(1);
        } catch (_) {}
    });
    win.on('focus', () => {
        if (!clientConfig.performanceMode) return;
        try {
            win.webContents.setFrameRate(60);
        } catch (_) {}
    });
});

app.whenReady().then(async () => {
    writeLog('Client initialized. Loading extensions into default session...');

    if (clientConfig.performanceMode) {
        try {
            session.defaultSession.webRequest.onBeforeRequest({
                urls: [
                    '*://*.sentry.io/*',
                    '*://*.sentry-cdn.com/*',
                    '*://*.datadoghq.com/*',
                    '*://*.segment.io/*',
                    '*://*.segment.com/*',
                    '*://api.amplitude.com/*',
                    '*://*.hotjar.com/*',
                    '*://*.google-analytics.com/*',
                    '*://*.googletagmanager.com/*'
                ]
            }, (_, callback) => {
                callback({ cancel: true });
            });
            writeLog('[Performance] Debloat active: Sentry, Datadog & telemetry trackers blocked');
        } catch (_) {}
    }

    await loadAllExtensions(session.defaultSession);

    setTimeout(() => {
        cleanOutdatedVersions();
    }, 5000);

    setTimeout(() => {
        checkForUpdates(true).catch(() => {});
    }, 8000);

    setInterval(() => {
        checkForUpdates(true).catch(() => {});
    }, 2 * 60 * 60 * 1000);
});

app.on('session-created', async (ses) => {
    if (ses !== session.defaultSession) {
        await loadAllExtensions(ses);
    }
});

module.exports = {
    loadAllExtensions,
    openExtensionsManager,
    openExtensionPage
};
