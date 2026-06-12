import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';
import { mount, type GeoInstance } from '@geoinsight/runtime';
import type { LayerFeature } from '@geoinsight/data';
import { Cursor, MapPin, LineSegments, Polygon, FloppyDisk, Plus, UploadSimple } from '@phosphor-icons/react';

type LayerIndex = Record<string, { file: string; kind: string }>;
type FC = { type: string; features: LayerFeature[]; [k: string]: unknown };
type Tool = 'select' | 'point' | 'line' | 'area';

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function App(): JSX.Element {
  const mapRef = useRef<HTMLDivElement>(null);
  const inst = useRef<GeoInstance | null>(null);
  const [index, setIndex] = useState<LayerIndex>({});
  const indexRef = useRef<LayerIndex>({});
  indexRef.current = index;

  const [active, setActive] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [fc, setFc] = useState<FC | null>(null);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [creating, setCreating] = useState(false);
  const [nl, setNl] = useState({ name: '', file: '', kind: 'flow' });
  const [pending, setPending] = useState<{ file: string; kind: 'new' | 'modified' }[]>([]);
  const [publishErr, setPublishErr] = useState<string[] | null>(null);

  // loadLayer/키 핸들러 클로저가 최신 상태를 보도록 ref 미러.
  const fcRef = useRef<FC | null>(fc);
  fcRef.current = fc;
  const editingRef = useRef<string | null>(editing);
  editingRef.current = editing;
  const draftRef = useRef<[number, number][]>(draft);
  draftRef.current = draft;
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;

  const refreshStatus = (): void => {
    window.geoApi
      .status()
      .then(setPending)
      .catch(() => setPending([]));
  };

  // 레이어 목록(index.json) + 미배포 상태.
  useEffect(() => {
    window.geoApi
      .index()
      .then(setIndex)
      .catch(() => setIndex({}));
    refreshStatus();
  }, []);

  const dsl = active.length > 0 ? `earth:\n  layers: ${active.join(', ')}` : 'earth:';

  // 지도 — 편집 중 레이어는 메모리(fcRef)+진행 중 draft 로 실시간 미리보기.
  useEffect(() => {
    if (!mapRef.current) return;
    inst.current?.destroy();
    inst.current = mount(mapRef.current, dsl, {
      interactive: true,
      loadLayer: async (name) => {
        if (name === editingRef.current && fcRef.current) {
          const base = fcRef.current.features;
          const d = draftRef.current;
          if (d.length === 0) return base;
          const draftFeat: LayerFeature = {
            type: 'Feature',
            id: '__draft__',
            properties: { name: 'draft', kor: '', kind: toolRef.current === 'area' ? 'cold' : 'warm' },
            geometry:
              d.length >= 2 ? { type: 'LineString', coordinates: d } : { type: 'Point', coordinates: d[0]! },
          };
          return [...base, draftFeat];
        }
        const file = indexRef.current[name]?.file;
        if (!file) return [];
        const data = (await window.geoApi.read(file)) as FC | null;
        return data?.features ?? [];
      },
    });
    return () => {
      inst.current?.destroy();
      inst.current = null;
    };
  }, [dsl, fc, draft]);

  const addFeature = (geometry: LayerFeature['geometry'], kind: string, korBase: string): void => {
    if (!fc || !editing) return;
    const id = `${editing}-${fc.features.length + 1}`;
    const feat: LayerFeature = {
      type: 'Feature',
      id,
      properties: { name: `New ${korBase}`, kor: `새 ${korBase}`, kind },
      geometry,
    };
    setFc({ ...fc, features: [...fc.features, feat] });
    setSelIdx(fc.features.length);
    setDirty(true);
  };

  const finishDraft = (): void => {
    const d = draftRef.current;
    if (toolRef.current === 'line' && d.length >= 2) {
      addFeature({ type: 'LineString', coordinates: d }, 'warm', '선');
    } else if (toolRef.current === 'area' && d.length >= 3) {
      addFeature({ type: 'Polygon', coordinates: [[...d, d[0]!]] }, 'cold', '면');
    }
    setDraft([]);
    setTool('select');
  };
  const finishRef = useRef(finishDraft);
  finishRef.current = finishDraft;

  // 키: Esc 취소 / Enter 완료.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setDraft([]);
        setTool('select');
      } else if (e.key === 'Enter' && draftRef.current.length > 0) {
        finishRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openLayer = async (name: string): Promise<void> => {
    setEditing(name);
    setActive([name]);
    setSelIdx(null);
    setDraft([]);
    setTool('select');
    const file = index[name]?.file;
    if (!file) return;
    const data = (await window.geoApi.read(file)) as FC | null;
    setFc(data ?? { type: 'FeatureCollection', features: [] });
    setDirty(false);
  };

  const updateProp = (key: string, value: unknown): void => {
    if (selIdx == null || !fc) return;
    const features = fc.features.map((f, i) =>
      i === selIdx ? { ...f, properties: { ...f.properties, [key]: value } } : f,
    );
    setFc({ ...fc, features });
    setDirty(true);
  };

  const save = async (): Promise<void> => {
    if (!editing || !fc) return;
    const file = index[editing]?.file;
    if (!file) return;
    await window.geoApi.write(file, fc);
    setDirty(false);
    refreshStatus();
  };

  const publish = async (): Promise<void> => {
    const r = await window.geoApi.publish();
    if (!r.ok) {
      setPublishErr(r.errors);
      return;
    }
    setPublishErr(null);
    refreshStatus();
  };

  const revert = async (): Promise<void> => {
    if (!confirm('작업본을 폐기하고 원본 상태로 되돌립니다. 저장하지 않은 편집은 사라집니다.')) return;
    await window.geoApi.revert();
    setPublishErr(null);
    refreshStatus();
    if (editing) void openLayer(editing); // 열린 레이어 다시 로드
  };

  const createLayer = async (): Promise<void> => {
    const name = nl.name.trim();
    const file = nl.file.trim();
    if (!name || !file) return;
    const idx = await window.geoApi.create(name, file, nl.kind.trim() || 'flow');
    setIndex(idx);
    setCreating(false);
    setNl({ name: '', file: '', kind: 'flow' });
    refreshStatus();
    void openLayer(name);
  };

  const onCanvasClick = (e: MouseEvent): void => {
    if (!inst.current || !fc || !editing) return;
    const ll = inst.current.unproject(e.clientX, e.clientY);
    if (!ll) return;
    const pt: [number, number] = [round(ll[0]), round(ll[1])];
    if (tool === 'point') {
      addFeature({ type: 'Point', coordinates: pt }, 'warm', '점');
      setTool('select');
    } else if (tool === 'line' || tool === 'area') {
      setDraft((d) => [...d, pt]);
    }
  };

  const names = Object.keys(index);
  const sel = selIdx != null && fc ? fc.features[selIdx] : null;
  const drawing = tool === 'line' || tool === 'area';
  const canFinish = tool === 'area' ? draft.length >= 3 : draft.length >= 2;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          GeoInsight <b>Layer Editor</b>
        </span>
        <ToggleGroup.Root
          className="tools"
          type="single"
          value={tool}
          onValueChange={(v) => {
            if (!v) return;
            setDraft([]);
            setTool(v as Tool);
          }}
        >
          <ToolItem value="select" label="선택">
            <Cursor />
          </ToolItem>
          <ToolItem value="point" label="점" disabled={!editing}>
            <MapPin />
          </ToolItem>
          <ToolItem value="line" label="선" disabled={!editing}>
            <LineSegments />
          </ToolItem>
          <ToolItem value="area" label="면" disabled={!editing}>
            <Polygon />
          </ToolItem>
        </ToggleGroup.Root>
        <div className="bar-right">
          <button className="ghost-btn" onClick={() => void revert()} disabled={pending.length === 0}>
            되돌리기
          </button>
          <button className="publish-btn" onClick={() => void publish()} disabled={pending.length === 0}>
            <UploadSimple weight="bold" size={15} />
            {pending.length > 0 ? `배포 ${pending.length}` : '배포됨'}
          </button>
          <button className="save-btn" disabled={!dirty} onClick={() => void save()}>
            <FloppyDisk weight="fill" size={15} />
            {dirty ? '저장 *' : '저장됨'}
          </button>
        </div>
      </header>

      {publishErr && (
        <div className="publish-error">
          <span className="pe-title">배포 실패 — 검증 오류</span>
          <ul>
            {publishErr.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <button className="pe-close" onClick={() => setPublishErr(null)}>
            닫기
          </button>
        </div>
      )}

      <div className="body">
        <aside className="left">
          <h2>레이어</h2>
          <ul className="layer-list">
            {names.length === 0 && <li className="empty">레이어 없음</li>}
            {names.map((name) => (
              <li key={name}>
                <button
                  className={`layer-item${editing === name ? ' sel' : ''}`}
                  onClick={() => void openLayer(name)}
                >
                  <span className="dot" data-kind={index[name]?.kind} />
                  {name}
                </button>
              </li>
            ))}
          </ul>
          {creating ? (
            <div className="new-layer">
              <input placeholder="이름 (예: 화산)" value={nl.name} onChange={(e) => setNl({ ...nl, name: e.target.value })} />
              <input placeholder="파일 (예: volcanoes)" value={nl.file} onChange={(e) => setNl({ ...nl, file: e.target.value })} />
              <input placeholder="종류 (flow/point/area)" value={nl.kind} onChange={(e) => setNl({ ...nl, kind: e.target.value })} />
              <div className="nl-actions">
                <button className="nl-ok" onClick={() => void createLayer()} disabled={!nl.name.trim() || !nl.file.trim()}>
                  생성
                </button>
                <button className="nl-cancel" onClick={() => setCreating(false)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button className="add-layer" onClick={() => setCreating(true)}>
              <Plus weight="bold" size={14} />
              새 레이어
            </button>
          )}
        </aside>

        <main className={`canvas${tool !== 'select' ? ' drawing' : ''}`} onClick={onCanvasClick}>
          <div ref={mapRef} className="map" data-geoinsight-root="true" />
          {drawing && (
            <div className="draft-bar" onClick={(e) => e.stopPropagation()}>
              <span>
                {tool === 'line' ? '선' : '면'} · {draft.length}점
              </span>
              <button className="db-ok" onClick={finishDraft} disabled={!canFinish}>
                완료 (Enter)
              </button>
              <button
                className="db-cancel"
                onClick={() => {
                  setDraft([]);
                  setTool('select');
                }}
              >
                취소 (Esc)
              </button>
            </div>
          )}
        </main>

        <aside className="right">
          {!editing ? (
            <p className="hint">왼쪽에서 레이어를 선택하세요.</p>
          ) : (
            <>
              <h2>
                {editing} · feature {fc?.features.length ?? 0}
              </h2>
              <ul className="feature-list">
                {fc?.features.map((f, i) => (
                  <li key={f.id}>
                    <button
                      className={`feature-item${selIdx === i ? ' sel' : ''}`}
                      onClick={() => setSelIdx(i)}
                    >
                      <span>{String(f.properties.kor || f.properties.name || f.id)}</span>
                      <span className="gtype">{f.geometry.type}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {sel && (
                <div className="prop-form">
                  <h2>속성</h2>
                  <Field label="이름(name)" value={String(sel.properties.name ?? '')} onChange={(v) => updateProp('name', v)} />
                  <Field label="한글(kor)" value={String(sel.properties.kor ?? '')} onChange={(v) => updateProp('kor', v)} />
                  <Field label="종류(kind)" value={String(sel.properties.kind ?? '')} onChange={(v) => updateProp('kind', v)} />
                  <NumberField label="크기(size)" value={sel.properties.size} onChange={(v) => updateProp('size', v)} />
                  <NumberField label="값(value)" value={sel.properties.value} onChange={(v) => updateProp('value', v)} />
                  <div className="row">
                    <label>형태</label>
                    <span>{sel.geometry.type}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ToolItem({
  value,
  label,
  disabled,
  children,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <ToggleGroup.Item className="tool" value={value} disabled={disabled} aria-label={label}>
          {children}
        </ToggleGroup.Item>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="tip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  );
}
