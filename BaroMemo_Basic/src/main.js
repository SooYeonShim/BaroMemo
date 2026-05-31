const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard, Tray, Menu, globalShortcut, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// IME(한/영 자판) 안정화를 위한 스위치들 추가
app.commandLine.appendSwitch('disable-features', 'ImeThread');
app.commandLine.appendSwitch('disable-direct-composition');

let mainWindow;
let tray;
let viewerWin;
let isQuitting = false;

// ── 데이터 경로 관리 ──────────────────────────────────────────────
const DEFAULT_USER_DATA = app.getPath('userData');
const CONFIG_PATH = path.join(DEFAULT_USER_DATA, 'config.json');

function getSettings() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {}
  return { dataPath: DEFAULT_USER_DATA, theme: 'light', windowState: null, autoLaunch: false };
}

function getMemosPath() {
  const { dataPath } = getSettings();
  return path.join(dataPath, 'memos.json');
}

function getImagesDir() {
  const { dataPath } = getSettings();
  const imgDir = path.join(dataPath, 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  return imgDir;
}

// ── 단일 인스턴스 잠금 ──────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.registerFileProtocol('memo-img', (request, callback) => {
      const url = request.url.substr(11); // 'memo-img://' 제거
      const decodedUrl = decodeURI(url);
      const imgPath = path.join(getImagesDir(), decodedUrl);
      callback({ path: imgPath });
    });

    createWindow();
    createTray();
    registerGlobalShortcuts();
  });
}

// ── 전역 단축키 등록 ──────────────────────────────────────────────
function registerGlobalShortcuts() {
  // 1. 창 표시/숨기기 (Alt+Shift+M)
  globalShortcut.register('Alt+Shift+M', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 2. 새 메모 작성 (Alt+Shift+N)
  globalShortcut.register('Alt+Shift+N', () => {
    const wasVisible = mainWindow.isVisible();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('new-memo', wasVisible);
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);

  const settings = getSettings();

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '열기', 
      type: 'normal',
      accelerator: 'Alt+Shift+M',
      click: () => {
        mainWindow.show();
      }
    },
    { 
      label: '새 메모', 
      accelerator: 'Alt+Shift+N',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('new-memo');
      }
    },
    { type: 'separator' },
    {
      label: '윈도우 시작 시 자동 실행',
      type: 'checkbox',
      checked: settings.autoLaunch,
      click: (menuItem) => {
        const isAutoLaunch = menuItem.checked;
        app.setLoginItemSettings({
          openAtLogin: isAutoLaunch,
          path: app.getPath('exe'),
          args: ['--hidden']
        });
        // 설정 저장
        try {
          const currentSettings = getSettings();
          currentSettings.autoLaunch = isAutoLaunch;
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
        } catch (e) {
          console.error('Failed to save auto-launch setting:', e);
        }
      }
    },
    { type: 'separator' },
    { 
      label: '종료', 
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('BaroMemo');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
  });
}

function createWindow() {
  const settings = getSettings();
  const isDark = settings.theme === 'dark';
  const bgColor = isDark ? '#111111' : '#f7f7f5';
  const ws = settings.windowState || {};

  const windowOptions = {
    width: ws.width || 420,
    height: ws.height || 700,
    minWidth: 420,
    minHeight: 450,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../assets/icon.ico'),
    backgroundColor: bgColor,
  };

  if (ws.x !== undefined && ws.y !== undefined) {
    windowOptions.x = ws.x;
    windowOptions.y = ws.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (ws.isMaximized) {
    mainWindow.maximize();
  }
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  });

const isHidden = process.argv.includes('--hidden');

mainWindow.once('ready-to-show', () => {
  if (!isHidden) {
    mainWindow.show();
  }
});

  let stateSaveTimer;
  const saveWindowState = () => {
    if (!mainWindow || isQuitting) return;
    try {
      const currentSettings = getSettings();
      currentSettings.windowState = {
        ...mainWindow.getNormalBounds(),
        isMaximized: mainWindow.isMaximized()
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save window state:', e);
    }
  };

  ipcMain.on('save-last-memo', (event, memoId) => {
    try {
      const currentSettings = getSettings();
      currentSettings.lastMemoId = memoId;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save last memo ID:', e);
    }
  });

  mainWindow.on('resize', () => {
    clearTimeout(stateSaveTimer);
    stateSaveTimer = setTimeout(saveWindowState, 500);
  });

  mainWindow.on('move', () => {
    clearTimeout(stateSaveTimer);
    stateSaveTimer = setTimeout(saveWindowState, 500);
  });

  // 닫기 버튼 클릭 시 트레이로 숨기기
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      saveWindowState(); // 숨기기 전 상태 저장
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximized-changed', true);
    saveWindowState();
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximized-changed', false);
    saveWindowState();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC 핸들러 ──────────────────────────────────────────────

ipcMain.handle('get-settings', () => {
  return getSettings();
});

ipcMain.handle('load-data', () => {
  const memosPath = getMemosPath();
  try {
    if (fs.existsSync(memosPath)) {
      return JSON.parse(fs.readFileSync(memosPath, 'utf-8'));
    }
  } catch (e) {}
  return { memos: [], folders: ['기본'], tags: [] };
});

ipcMain.handle('save-data', (_, data) => {
  const memosPath = getMemosPath();
  try {
    const dataDir = path.dirname(memosPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(memosPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
});

ipcMain.handle('change-data-path', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '데이터 저장 폴더 선택',
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (canceled) return null;
  
  const newDataPath = filePaths[0];
  const settings = { dataPath: newDataPath, theme: getSettings().theme };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  
  const memosPath = path.join(newDataPath, 'memos.json');
  if (fs.existsSync(memosPath)) {
    return JSON.parse(fs.readFileSync(memosPath, 'utf-8'));
  }
  return { memos: [], folders: ['기본'], tags: [] };
});

ipcMain.handle('cleanup-images', async (event, memos) => {
  try {
    const imgDir = getImagesDir();
    if (!fs.existsSync(imgDir)) return { success: true, deleted: 0 };

    // 1. 모든 메모 본문에서 사용 중인 이미지 파일명 추출
    const usedFiles = new Set();
    memos.forEach(memo => {
      const matches = memo.content.matchAll(/img_\d+\.[a-zA-Z]+/g);
      for (const match of matches) {
        usedFiles.add(match[0]);
      }
    });

    // 2. 실제 폴더 내의 파일들과 비교하여 사용되지 않는 파일 삭제
    const allFiles = fs.readdirSync(imgDir);
    let deletedCount = 0;

    allFiles.forEach(file => {
      if (file.startsWith('img_') && !usedFiles.has(file)) {
        try {
          fs.unlinkSync(path.join(imgDir, file));
          deletedCount++;
        } catch (e) {
          console.error(`Failed to delete orphaned image: ${file}`, e);
        }
      }
    });

    return { success: true, deleted: deletedCount };
  } catch (e) {
    console.error('Image cleanup failed:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-json', async (_, data) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '메모 내보내기',
    defaultPath: `memos_backup_${new Date().toISOString().slice(0,10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (filePath) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  }
  return false;
});

ipcMain.handle('save-image', (_, base64Data, ext) => {
  const imgDir = getImagesDir();
  const filename = `img_${Date.now()}.${ext}`;
  const filepath = path.join(imgDir, filename);
  const buf = Buffer.from(base64Data.split(',')[1], 'base64');
  fs.writeFileSync(filepath, buf);
  return `memo-img://${filename}`;
});

ipcMain.on('copy-image', (event, src) => {
  try {
    let filePath = src;
    if (src.startsWith('memo-img://')) {
      const filename = src.substr(11);
      filePath = path.join(getImagesDir(), decodeURIComponent(filename));
    } else {
      filePath = src.replace('file:///', '').replace('file://', '');
    }
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      clipboard.clear();
      clipboard.writeImage(image);
    }
  } catch (err) {
    console.error('Failed to copy image:', err);
  }
});

ipcMain.on('copy-mixed', (event, html, text, src) => {
  try {
    const imgDir = getImagesDir();

    let modifiedHtml = html.replace(/memo-img:\/\/([^">\s]+)/g, (match, filename) => {
      try {
        const fullPath = path.join(imgDir, decodeURIComponent(filename));
        const img = nativeImage.createFromPath(fullPath);
        if (!img.isEmpty()) {
          const buffer = img.toJPEG(80);
          return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
      } catch (e) {
        console.error('Failed to convert image for clipboard:', e);
      }
      return match;
    });

    modifiedHtml = modifiedHtml.replace(/<img([^>]*?)>/g, (match, attrs) => {
      return `<img${attrs.replace(/style="[^"]*"/, '')} style="max-width:100%; vertical-align:top;">`;
    });

    clipboard.clear();
    clipboard.write({ html: modifiedHtml, text: text });
  } catch (err) {
    console.error('Failed to copy mixed content:', err);
  }
});

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.minimize();
});
ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.close();
});
ipcMain.on('open-explorer', () => {
  const { dataPath } = getSettings();
  shell.openPath(dataPath);
});
ipcMain.on('toggle-always-on-top', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  mainWindow.webContents.send('always-on-top-changed', next);
});

ipcMain.on('set-theme', (event, theme) => {
  try {
    const settings = getSettings();
    settings.theme = theme;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save theme setting:', e);
  }
});

ipcMain.on('open-image-viewer', (event, src, theme, width, height) => {
  if (!viewerWin) {
    viewerWin = new BrowserWindow({
      width: width || 800,
      height: (height || 600) + 36,
      useContentSize: true,
      frame: false,
      transparent: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });

    viewerWin.loadFile(path.join(__dirname, 'viewer.html'));

    viewerWin.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        viewerWin.hide();
      }
    });

    viewerWin.once('ready-to-show', () => {
      viewerWin.show();
      viewerWin.webContents.send('set-image', src, theme);
    });
    
    viewerWin.on('closed', () => {
      viewerWin = null;
    });
  } else {
    viewerWin.setSize(width || 800, (height || 600) + 36);
    viewerWin.show();
    viewerWin.webContents.send('set-image', src, theme);
  }
});
