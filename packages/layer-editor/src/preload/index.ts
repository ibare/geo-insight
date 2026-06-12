import { contextBridge, ipcRenderer } from 'electron';

/** renderer 에 노출되는 안전한 fs 브리지 — main 의 IPC 핸들러로 위임. */
const geoApi = {
  /** 레이어 index.json(이름→{file,kind}). */
  index: (): Promise<Record<string, { file: string; kind: string }>> =>
    ipcRenderer.invoke('layers:index'),
  /** 레이어 데이터 파일(FeatureCollection) 읽기. */
  read: (file: string): Promise<unknown> => ipcRenderer.invoke('layers:read', file),
  /** 레이어 데이터 파일 쓰기(편집 저장). */
  write: (file: string, data: unknown): Promise<boolean> =>
    ipcRenderer.invoke('layers:write', file, data),
  /** 새 레이어 등록(index.json + 빈 파일). 갱신된 index 반환. */
  create: (name: string, file: string, kind: string): Promise<Record<string, { file: string; kind: string }>> =>
    ipcRenderer.invoke('layers:create', name, file, kind),
  /** 미배포 변경 목록(작업본↔원본 diff). */
  status: (): Promise<{ file: string; kind: 'new' | 'modified' }[]> => ipcRenderer.invoke('layers:status'),
  /** 배포 — 작업본을 검증 후 원본에 반영. 검증 실패 시 errors 반환. */
  publish: (): Promise<{ ok: boolean; errors: string[] }> => ipcRenderer.invoke('layers:publish'),
  /** 되돌리기 — 작업본을 폐기하고 원본으로 리셋. */
  revert: (): Promise<boolean> => ipcRenderer.invoke('layers:revert'),
};

contextBridge.exposeInMainWorld('geoApi', geoApi);

export type GeoApi = typeof geoApi;
