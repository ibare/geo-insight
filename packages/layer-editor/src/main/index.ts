import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 레이어 데이터 자산 디렉터리 — A 모델: monorepo 의 packages/data/assets/layers 를
 * 직접 읽고 쓴다(편집 → 파일 갱신 → git → 빌드 → 배포). 빌드 산출물(out/main) 기준
 * 상대경로, 또는 GEO_LAYERS_DIR 로 오버라이드(배포 빌드/외부 repo 용).
 */
function layersDir(): string {
  if (process.env.GEO_LAYERS_DIR) return process.env.GEO_LAYERS_DIR;
  return join(here, '../../../data/assets/layers');
}

ipcMain.handle('layers:index', () => {
  const p = join(layersDir(), 'index.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
});

ipcMain.handle('layers:read', (_e, file: string) => {
  const p = join(layersDir(), `${file}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
});

ipcMain.handle('layers:write', (_e, file: string, data: unknown) => {
  const p = join(layersDir(), `${file}.json`);
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return true;
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0e1420',
    title: 'GeoInsight Layer Editor',
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(here, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
