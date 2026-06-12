import { useEffect, useRef, useState } from 'react';
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
  const [saveVersion, setSaveVersion] = useState(0);

  // 레이어 목록(index.json) — main fs IPC.
  useEffect(() => {
    window.geoApi
      .index()
      .then(setIndex)
      .catch(() => setIndex({}));
  }, []);

  const dsl = active.length > 0 ? `earth:\n  layers: ${active.join(', ')}` : 'earth:';

  // 지도 — 활성 레이어 표시. loadLayer 는 디스크(geoApi.read)를 직접 읽어
  // 저장(write) 후 saveVersion 증가 → 재마운트하면 최신 데이터가 반영된다(캐시 없음).
  useEffect(() => {
    if (!mapRef.current) return;
    inst.current?.destroy();
    inst.current = mount(mapRef.current, dsl, {
      interactive: true,
      loadLayer: async (name) => {
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
  }, [dsl, saveVersion]);

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
    setSaveVersion((v) => v + 1); // 지도 재로드(디스크 최신 반영)
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
          <button className="tool" disabled title="점 (준비 중)">
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

        <main className="canvas">
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
