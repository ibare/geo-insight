import { useEffect, useRef, useState } from 'react';
import { mount, type GeoInstance } from '@geoinsight/runtime';
import { loadLayerBrowser } from '@geoinsight/data/browser';

type LayerIndex = Record<string, { file: string; kind: string }>;

export function App(): JSX.Element {
  const mapRef = useRef<HTMLDivElement>(null);
  const inst = useRef<GeoInstance | null>(null);
  const [index, setIndex] = useState<LayerIndex>({});
  const [active, setActive] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // 레이어 목록(index.json) — main 의 fs IPC.
  useEffect(() => {
    window.geoApi
      .index()
      .then(setIndex)
      .catch(() => setIndex({}));
  }, []);

  // 지도 마운트 + 활성 레이어 변경 시 재렌더.
  const dsl = active.length > 0 ? `earth:\n  layers: ${active.join(', ')}` : 'earth:';
  useEffect(() => {
    if (!mapRef.current) return;
    if (!inst.current) {
      inst.current = mount(mapRef.current, dsl, { interactive: true, loadLayer: loadLayerBrowser });
    } else {
      inst.current.update(dsl);
    }
  }, [dsl]);
  useEffect(
    () => () => {
      inst.current?.destroy();
      inst.current = null;
    },
    [],
  );

  const toggle = (name: string): void =>
    setActive((a) => (a.includes(name) ? a.filter((n) => n !== name) : [...a, name]));

  const names = Object.keys(index);

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
      </header>

      <div className="body">
        <aside className="left">
          <h2>레이어</h2>
          <ul className="layer-list">
            {names.length === 0 && <li className="empty">레이어 없음</li>}
            {names.map((name) => (
              <li key={name}>
                <button
                  className={`layer-item${active.includes(name) ? ' on' : ''}${selected === name ? ' sel' : ''}`}
                  onClick={() => {
                    toggle(name);
                    setSelected(name);
                  }}
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
          <h2>속성</h2>
          {selected ? (
            <div className="props">
              <div className="row">
                <label>이름</label>
                <span>{selected}</span>
              </div>
              <div className="row">
                <label>파일</label>
                <span>{index[selected]?.file}.json</span>
              </div>
              <div className="row">
                <label>종류</label>
                <span>{index[selected]?.kind}</span>
              </div>
              <div className="row">
                <label>표시</label>
                <span>{active.includes(selected) ? '켜짐' : '꺼짐'}</span>
              </div>
            </div>
          ) : (
            <p className="hint">왼쪽에서 레이어를 선택하세요.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
