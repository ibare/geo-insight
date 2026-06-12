import { app, BrowserWindow, ipcMain } from 'electron';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 원본(빌드 자산) — packages/data/assets/layers. A 모델: 편집 결과가 빌드되어
 * methii 로 배포된다. 단 **배포(publish) 시에만** 기록한다. GEO_LAYERS_DIR 로 오버라이드.
 */
function srcDir(): string {
  if (process.env.GEO_LAYERS_DIR) return process.env.GEO_LAYERS_DIR;
  return join(here, '../../../data/assets/layers');
}

/** 작업본(샌드박스) — userData 하위. 편집·저장은 전부 여기로 격리한다. */
function workDir(): string {
  return join(app.getPath('userData'), 'layers-workspace');
}

const jsonFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

/** 임시 파일에 쓰고 rename — 쓰는 도중 크래시해도 원본이 잘리지 않는다. */
function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

/** 작업본이 비어 있으면 원본을 복사해 시드. */
function ensureSeed(): void {
  const wd = workDir();
  if (!existsSync(wd)) mkdirSync(wd, { recursive: true });
  if (jsonFiles(wd).length > 0) return;
  const sd = srcDir();
  for (const f of jsonFiles(sd)) copyFileSync(join(sd, f), join(wd, f));
}

// ── 스키마 검증 ────────────────────────────────────────────────
const isPos = (p: unknown): boolean =>
  Array.isArray(p) &&
  p.length >= 2 &&
  typeof p[0] === 'number' &&
  typeof p[1] === 'number' &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]);

/** geometry 종류별 좌표 중첩 깊이(위치 배열까지)를 재귀로 검사. */
function checkCoords(type: string, c: unknown): boolean {
  const depth = type === 'Point' ? 0 : type === 'Polygon' ? 2 : 1; // Line/MultiPoint = 1
  const walk = (v: unknown, d: number): boolean =>
    d === 0 ? isPos(v) : Array.isArray(v) && v.length > 0 && v.every((x) => walk(x, d - 1));
  return walk(c, depth);
}

const GEOM_TYPES = ['Point', 'MultiPoint', 'LineString', 'Polygon'];

/** FeatureCollection 검증 — 통과하면 null, 아니면 사람이 읽을 오류 문자열. */
function validateFC(data: unknown): string | null {
  const fc = data as { type?: string; features?: unknown };
  if (!fc || fc.type !== 'FeatureCollection') return 'FeatureCollection 형식 아님';
  if (!Array.isArray(fc.features)) return 'features 가 배열이 아님';
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i] as { geometry?: { type?: string; coordinates?: unknown } };
    const g = f?.geometry;
    if (!g || typeof g.type !== 'string') return `feature ${i}: geometry 없음`;
    if (!GEOM_TYPES.includes(g.type)) return `feature ${i}: 알 수 없는 geometry "${g.type}"`;
    if (!checkCoords(g.type, g.coordinates)) return `feature ${i}: 좌표 형식 오류(${g.type})`;
  }
  return null;
}

// ── IPC: 작업본 대상 ───────────────────────────────────────────
ipcMain.handle('layers:index', () => {
  ensureSeed();
  const p = join(workDir(), 'index.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
});

ipcMain.handle('layers:read', (_e, file: string) => {
  const p = join(workDir(), `${file}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
});

ipcMain.handle('layers:write', (_e, file: string, data: unknown) => {
  atomicWrite(join(workDir(), `${file}.json`), `${JSON.stringify(data, null, 2)}\n`);
  return true;
});

/** 새 레이어 등록 — 작업본 index.json + 빈 FeatureCollection. 갱신된 index 반환. */
ipcMain.handle('layers:create', (_e, name: string, file: string, kind: string) => {
  const dir = workDir();
  const idxPath = join(dir, 'index.json');
  const idx: Record<string, { file: string; kind: string }> = existsSync(idxPath)
    ? JSON.parse(readFileSync(idxPath, 'utf8'))
    : {};
  if (!idx[name]) {
    idx[name] = { file, kind };
    atomicWrite(idxPath, `${JSON.stringify(idx, null, 2)}\n`);
  }
  const fp = join(dir, `${file}.json`);
  if (!existsSync(fp)) {
    atomicWrite(fp, `${JSON.stringify({ type: 'FeatureCollection', layer: file, features: [] }, null, 2)}\n`);
  }
  return idx;
});

// ── IPC: 배포/상태/되돌리기 ────────────────────────────────────
type Change = { file: string; kind: 'new' | 'modified' };

/** 작업본↔원본 diff — 미배포 변경 목록. */
function diffWorkspace(): Change[] {
  const wd = workDir();
  const sd = srcDir();
  const srcSet = new Set(jsonFiles(sd));
  const out: Change[] = [];
  for (const f of jsonFiles(wd)) {
    if (!srcSet.has(f)) {
      out.push({ file: f, kind: 'new' });
    } else if (readFileSync(join(wd, f), 'utf8') !== readFileSync(join(sd, f), 'utf8')) {
      out.push({ file: f, kind: 'modified' });
    }
  }
  return out;
}

ipcMain.handle('layers:status', () => diffWorkspace());

/** 배포 — 작업본 전체를 검증 후 원본에 원자적으로 반영. 검증 실패 시 아무것도 쓰지 않는다. */
ipcMain.handle('layers:publish', () => {
  const wd = workDir();
  const sd = srcDir();
  const errors: string[] = [];
  for (const f of jsonFiles(wd)) {
    if (f === 'index.json') continue;
    try {
      const err = validateFC(JSON.parse(readFileSync(join(wd, f), 'utf8')));
      if (err) errors.push(`${f}: ${err}`);
    } catch {
      errors.push(`${f}: JSON 파싱 실패`);
    }
  }
  if (errors.length) return { ok: false, errors };

  for (const f of jsonFiles(wd)) atomicWrite(join(sd, f), readFileSync(join(wd, f), 'utf8'));
  return { ok: true, errors: [] };
});

/** 되돌리기 — 작업본을 폐기하고 원본으로 리셋. */
ipcMain.handle('layers:revert', () => {
  const wd = workDir();
  const sd = srcDir();
  for (const f of jsonFiles(wd)) rmSync(join(wd, f));
  for (const f of jsonFiles(sd)) copyFileSync(join(sd, f), join(wd, f));
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
  ensureSeed();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
