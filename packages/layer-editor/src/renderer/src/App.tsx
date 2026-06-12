import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { mount, type GeoInstance } from '@geoinsight/runtime';
import type { LayerFeature } from '@geoinsight/data';

type LayerIndex = Record<string, { file: string; kind: string }>;
type FC = { type: string; features: LayerFeature[]; [k: string]: unknown };

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
  const [tool, setTool] = useState<'select' | 'point'>('select');

  // loadLayer 클로저가 항상 최신 편집 데이터를 보도록 ref 미러.
  const fcRef = useRef<FC | null>(fc);
  fcRef.current = fc;
  const editingRef = useRef<string | null>(editing);
  editingRef.current = editing;

  // 레이어 목록(index.json) — main fs IPC.
  useEffect(() => {
    window.geoApi
      .index()
      .then(setIndex)
      .catch(() => setIndex({}));
  }, []);

  const dsl = active.length > 0 ? `earth:\n  layers: ${active.join(', ')}` : 'earth:';

  // 지도 — 활성 레이어 표시. 편집 중 레이어는 메모리(fcRef) 데이터로 실시간 미리보기,
  // 나머지는 디스크(geoApi.read). fc 변경 시 재마운트해 편집 결과가 바로 반영된다.
  useEffect(() => {
    if (!mapRef.current) return;
    inst.current?.destroy();
    inst.current = mount(mapRef.current, dsl, {
      interactive: true,
      loadLayer: async (name) => {
        if (name === editingRef.current && fcRef.current) return fcRef.current.features;
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
  }, [dsl, fc]);

  const openLayer = async (name: string): Promise<void> => {
    setEditing(name);
    setActive([name]);
    setSelIdx(null);
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
  };

  // 점 도구 — 캔버스 클릭 위치를 위경도로 바꿔 Point feature 추가.
  const onCanvasClick = (e: MouseEvent): void => {
    if (tool !== 'point' || !inst.current || !fc || !editing) return;
    const ll = inst.current.unproject(e.clientX, e.clientY);
    if (!ll) return;
    const round = (n: number): number => Math.round(n * 1000) / 1000;
    const feat: LayerFeature = {
      type: 'Feature',
      id: `${editing}-${fc.features.length + 1}`,
      properties: { name: 'New point', kor: '새 점', kind: 'warm' },
      geometry: { type: 'Point', coordinates: [round(ll[0]), round(ll[1])] },
    };
    const features = [...fc.features, feat];
    setFc({ ...fc, features });
    setSelIdx(features.length - 1);
    setDirty(true);
  };

  const names = Object.keys(index);
  const sel = selIdx != null && fc ? fc.features[selIdx] : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          GeoInsight <b>Layer Editor</b>
        </span>
        <div className="tools">
          <button
            className={`tool${tool === 'select' ? ' on' : ''}`}
            title="선택"
            onClick={() => setTool('select')}
          >
            ⬚
          </button>
          <button
            className={`tool${tool === 'point' ? ' on' : ''}`}
            title="점 찍기"
            disabled={!editing}
            onClick={() => setTool('point')}
          >
            ●
          </button>
          <button className="tool" disabled title="선 (준비 중)">
            ╱
          </button>
          <button className="tool" disabled title="면 (준비 중)">
            ▱
          </button>
        </div>
        <button className="save-btn" disabled={!dirty} onClick={() => void save()}>
          {dirty ? '저장 *' : '저장됨'}
        </button>
      </header>

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
        </aside>

        <main className={`canvas${tool === 'point' ? ' drawing' : ''}`} onClick={onCanvasClick}>
          <div ref={mapRef} className="map" data-geoinsight-root="true" />
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
