import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import { mount, type GeoInstance } from '@geo-insight/runtime';
import { cardinalSpline, DEFAULT_FLOW_WIDTH_PARAMS, DEFAULT_THEME } from '@geo-insight/core';
import type { LayerFeature } from '@geo-insight/data';
import { Cursor, MapPin, FlowArrow, Polygon, FloppyDisk, Plus, UploadSimple, Trash } from '@phosphor-icons/react';

type LayerIndex = Record<string, { file: string; kind: string }>;
type FC = { type: string; features: LayerFeature[]; [k: string]: unknown };
type Tool = 'select' | 'point' | 'flow' | 'area';

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
  // 보기 전용 지구본 — true 면 orthographic 으로 조망(편집 불가, flat 에서만 편집).
  const [globe, setGlobe] = useState(false);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [creating, setCreating] = useState(false);
  const [nl, setNl] = useState({ name: '', file: '', kind: 'flow' });
  const [pending, setPending] = useState<{ file: string; kind: 'new' | 'modified' }[]>([]);
  const [publishErr, setPublishErr] = useState<string[] | null>(null);

  const overlayRef = useRef<SVGSVGElement>(null);

  // loadLayer/키 핸들러/rAF 클로저가 최신 상태를 보도록 ref 미러.
  const fcRef = useRef<FC | null>(fc);
  fcRef.current = fc;
  const editingRef = useRef<string | null>(editing);
  editingRef.current = editing;
  const draftRef = useRef<[number, number][]>(draft);
  draftRef.current = draft;
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const globeRef = useRef(globe);
  globeRef.current = globe;
  const selIdxRef = useRef<number | null>(selIdx);
  selIdxRef.current = selIdx;
  // 드래그 상태 — setState 없이 ref+rAF 로만 갱신(지도 remount 회피).
  const dragVtxRef = useRef<number | null>(null); // 드래그 중 정점 인덱스
  const dragCoordsRef = useRef<[number, number][] | null>(null); // 드래그 중 선택 피처 좌표 사본
  const draggedRef = useRef(false); // 실제 이동 발생(드래그 직후 click 억제)

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

  const dsl =
    'earth:' +
    (globe ? '\n  projection: orthographic' : '') +
    (active.length > 0 ? `\n  layers: ${active.join(', ')}` : '');
  const dslRef = useRef(dsl);
  dslRef.current = dsl;

  // 편집 중 레이어의 표시 피처 = 메모리(fcRef) + 진행 중 draft. loadLayer 와 setLayerData 가 공유.
  const composeEditingFeatures = (): LayerFeature[] => {
    const f = fcRef.current;
    if (!f) return [];
    const d = draftRef.current;
    if (d.length === 0) return f.features;
    const isFlow = toolRef.current === 'flow';
    const draftFeat: LayerFeature = {
      type: 'Feature',
      id: '__draft__',
      properties: {
        name: 'draft',
        kor: '',
        kind: toolRef.current === 'area' ? 'cold' : 'warm',
        // 흐름 draft 는 prim:'flow' 로 그려 생성 중에도 곡선 미리보기(3점부터 곡선).
        ...(isFlow ? { prim: 'flow' as const, width: 30 } : {}),
      },
      // 면 draft 는 닫힌 Polygon 으로 미리보기(흐름선 아님). 흐름/점은 LineString/Point.
      geometry:
        toolRef.current === 'area' && d.length >= 3
          ? { type: 'Polygon', coordinates: [[...d, d[0]!]] }
          : d.length >= 2
            ? { type: 'LineString', coordinates: d }
            : { type: 'Point', coordinates: d[0]! },
    };
    return [...f.features, draftFeat];
  };

  // 지도 — 최초 1회만 마운트. 이후 dsl(레이어·투영) 변경은 update 로 재컴파일하되 뷰
  // (중심·줌)를 보존한다(flat↔globe 전환 시 보던 위치 유지). fc/draft 는 아래 effect.
  useEffect(() => {
    if (!mapRef.current) return;
    inst.current = mount(mapRef.current, dslRef.current, {
      interactive: true,
      // 편집기는 LOD(줌아웃 시 좁은 흐름 소멸)를 끈다 — 편집 대상은 줌과 무관하게 항상
      // 보여야 한다(임계 0 = 모든 흐름·라벨 표시). 두께는 여전히 km×줌으로 그려진다.
      flowWidthParams: { ...DEFAULT_FLOW_WIDTH_PARAMS, hideBelowPx: 0, fadeToPx: 0, labelHidePx: 0, labelFadePx: 0 },
      loadLayer: async (name) => {
        if (name === editingRef.current && fcRef.current) return composeEditingFeatures();
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
  }, []);

  // dsl(레이어 목록·투영) 변경 — remount 없이 update(뷰 보존, ViewState 로 중심·줌 유지).
  useEffect(() => {
    inst.current?.update(dsl);
  }, [dsl]);

  // 데이터(fc)·draft 변경 — remount 없이 레이어 데이터만 교체(뷰/줌 보존, 캐시 우회).
  useEffect(() => {
    const ed = editingRef.current;
    if (ed) inst.current?.setLayerData(ed, composeEditingFeatures());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, draft]);

  const addFeature = (
    geometry: LayerFeature['geometry'],
    kind: string,
    korBase: string,
    extra: Partial<LayerFeature['properties']> = {},
  ): void => {
    if (!fc || !editing) return;
    const id = `${editing}-${fc.features.length + 1}`;
    const feat: LayerFeature = {
      type: 'Feature',
      id,
      properties: { name: `New ${korBase}`, kor: `새 ${korBase}`, kind, ...extra },
      geometry,
    };
    setFc({ ...fc, features: [...fc.features, feat] });
    setSelIdx(fc.features.length);
    setDirty(true);
  };

  const finishDraft = (): void => {
    const d = draftRef.current;
    if (toolRef.current === 'flow' && d.length >= 3) {
      // 흐름 프리미티브 — 제어점 중심선 + 기본 표현 파라미터.
      addFeature({ type: 'LineString', coordinates: d }, 'warm', '흐름', { prim: 'flow', width: 30, arrow: true });
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
      const ae = document.activeElement;
      const typing = ae?.tagName === 'INPUT' || ae?.tagName === 'TEXTAREA';
      if (e.key === 'Escape') {
        setDraft([]);
        setTool('select');
      } else if (e.key === 'Enter' && draftRef.current.length > 0) {
        finishRef.current();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selIdxRef.current != null) {
        e.preventDefault();
        deleteFeatureRef.current(selIdxRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 선택 하이라이트 — rAF 로 매 프레임 재투영(지도 내부 팬·줌·회전 + 드래그 동기화).
  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      const svg = overlayRef.current;
      const gi = inst.current;
      if (svg && gi) {
        const i = selIdxRef.current;
        const ft = i != null && fcRef.current ? fcRef.current.features[i] : null;
        if (ft) {
          // 드래그 중이면 ref 좌표(미커밋)로 그림 — setState 없이 실시간.
          const coords = dragCoordsRef.current ?? (ft.geometry.coordinates as [number, number][]);
          const geom = { ...ft.geometry, coordinates: coords } as Geom;
          svg.innerHTML = highlightSvg(geom, gi, ft.properties.prim === 'flow', !globeRef.current);
        } else {
          svg.innerHTML = '';
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 제어점 드래그 — window 리스너(핸들 DOM 이 rAF 로 재생성돼도 끊기지 않게).
  useEffect(() => {
    const move = (e: globalThis.MouseEvent): void => {
      const v = dragVtxRef.current;
      const coords = dragCoordsRef.current;
      const gi = inst.current;
      if (v == null || !coords || !gi) return;
      const ll = gi.unproject(e.clientX, e.clientY);
      if (!ll) return;
      coords[v] = [round(ll[0]), round(ll[1])];
      draggedRef.current = true; // rAF 오버레이가 coords 를 그림
    };
    const up = (): void => {
      if (dragVtxRef.current == null) return;
      const i = selIdxRef.current;
      const f = fcRef.current;
      const coords = dragCoordsRef.current;
      if (i != null && f && coords) {
        // 드래그 종료 — fc 에 1회 커밋(지도 remount 1회). 드래그 대상은 LineString.
        setFc({
          ...f,
          features: f.features.map((x, k) =>
            k === i ? ({ ...x, geometry: { ...x.geometry, coordinates: coords } } as LayerFeature) : x,
          ),
        });
        setDirty(true);
      }
      dragVtxRef.current = null;
      dragCoordsRef.current = null;
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // 선택 피처의 좌표를 교체 커밋.
  const commitCoords = (i: number, coords: [number, number][]): void => {
    const f = fcRef.current;
    if (!f) return;
    setFc({
      ...f,
      features: f.features.map((x, k) => (k === i ? ({ ...x, geometry: { ...x.geometry, coordinates: coords } } as LayerFeature) : x)),
    });
    setDirty(true);
  };

  // 오버레이 핸들 상호작용(이벤트 위임):
  //  - 제어점 핸들: 드래그 이동, Alt+클릭 = 삭제(최소 3점 유지)
  //  - 세그먼트 중점 '+' 핸들: 그 자리에 제어점 삽입 후 바로 드래그
  const onOverlayDown = (e: MouseEvent): void => {
    const el = e.target as Element;
    const vtx = el.getAttribute?.('data-vtx');
    const mid = el.getAttribute?.('data-mid');
    if (vtx == null && mid == null) return;
    e.stopPropagation();
    const i = selIdxRef.current;
    const f = fcRef.current;
    const ft = i != null ? f?.features[i] : null;
    if (!ft || i == null) return;
    const coords = ft.geometry.coordinates as [number, number][];

    if (mid != null) {
      // 세그먼트 seg 와 seg+1 사이에 중점 제어점 삽입 → 바로 드래그.
      const seg = Number(mid);
      const a = coords[seg]!;
      const b = coords[seg + 1]!;
      const ins: [number, number] = [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
      const next = coords.slice();
      next.splice(seg + 1, 0, ins);
      dragVtxRef.current = seg + 1;
      dragCoordsRef.current = next.map((c) => [...c] as [number, number]);
      draggedRef.current = false;
      return;
    }

    const v = Number(vtx);
    if (e.altKey) {
      // 제어점 삭제 — 흐름 최소 3점 유지.
      if (coords.length > 3) commitCoords(i, coords.filter((_, k) => k !== v));
      return;
    }
    // 드래그 이동.
    dragVtxRef.current = v;
    dragCoordsRef.current = coords.map((c) => [...c] as [number, number]);
    draggedRef.current = false;
  };

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
    if (!confirm('작업본을 원본(빌드 자산)으로 다시 시드합니다. 미배포 편집은 모두 사라집니다.')) return;
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

  const deleteFeature = (i: number): void => {
    if (!fc) return;
    setFc({ ...fc, features: fc.features.filter((_, k) => k !== i) });
    setSelIdx(null);
    setDirty(true);
  };
  const deleteFeatureRef = useRef(deleteFeature);
  deleteFeatureRef.current = deleteFeature;

  /** 화면 클릭과 가장 가까운 피처 인덱스(8px 이내) — 캔버스 직접 선택. */
  const hitTest = (clientX: number, clientY: number): number | null => {
    const gi = inst.current;
    const f = fc;
    if (!gi || !f || !mapRef.current) return null;
    const rect = mapRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: number | null = null;
    let bestD = 8;
    f.features.forEach((ft, i) => {
      const d = distToFeature(ft.geometry, px, py, gi);
      if (d != null && d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const onCanvasClick = (e: MouseEvent): void => {
    if (!inst.current || !fc || !editing) return;
    if (tool === 'select') {
      if (draggedRef.current) return; // 드래그 직후 click 무시
      setSelIdx(hitTest(e.clientX, e.clientY)); // 빈 곳 클릭 → 선택 해제
      return;
    }
    const ll = inst.current.unproject(e.clientX, e.clientY);
    if (!ll) return;
    const pt: [number, number] = [round(ll[0]), round(ll[1])];
    if (tool === 'point') {
      addFeature({ type: 'Point', coordinates: pt }, 'warm', '점');
      setTool('select');
    } else if (tool === 'flow' || tool === 'area') {
      setDraft((d) => [...d, pt]);
    }
  };

  const names = Object.keys(index);
  const sel = selIdx != null && fc ? fc.features[selIdx] : null;
  const drawing = tool === 'flow' || tool === 'area';
  const canFinish = draft.length >= 3; // 흐름·면 모두 최소 3점

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
          <ToolItem value="point" label="점" disabled={!editing || globe}>
            <MapPin />
          </ToolItem>
          <ToolItem value="flow" label="흐름" disabled={!editing || globe}>
            <FlowArrow />
          </ToolItem>
          <ToolItem value="area" label="면" disabled={!editing || globe}>
            <Polygon />
          </ToolItem>
        </ToggleGroup.Root>
        <div className="bar-right">
          <button
            className={`ghost-btn${globe ? ' active' : ''}`}
            title={globe ? '평면(편집)으로' : '지구본(보기)으로'}
            onClick={() => {
              const next = !globe;
              setGlobe(next);
              // 지구본은 보기 전용 — 켜면 진행 중 편집을 접고 선택 모드로.
              if (next) {
                setDraft([]);
                setTool('select');
              }
            }}
          >
            {globe ? '평면' : '지구본'}
          </button>
          <button className="ghost-btn" onClick={() => void revert()}>
            시드 교체
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
          <svg ref={overlayRef} className="overlay" onMouseDown={onOverlayDown} />
          {drawing && (
            <div className="draft-bar" onClick={(e) => e.stopPropagation()}>
              <span>
                {tool === 'flow' ? '흐름' : '면'} · {draft.length}점{draft.length < 3 ? ' (최소 3점)' : ''}
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
                  {sel.properties.prim === 'flow' ? (
                    <>
                      <KindSwatch value={String(sel.properties.kind ?? '')} onChange={(v) => updateProp('kind', v)} />
                      <SliderField
                        label="두께(km)"
                        min={10}
                        max={150}
                        step={5}
                        value={Number(sel.properties.width ?? 30)}
                        onChange={(v) => updateProp('width', v)}
                      />
                      <SwitchField
                        label="화살촉"
                        checked={sel.properties.arrow !== false}
                        onChange={(v) => updateProp('arrow', v)}
                      />
                      <SwitchField
                        label="점선"
                        checked={sel.properties.dash === true}
                        onChange={(v) => updateProp('dash', v)}
                      />
                      <p className="edit-hint">선 위 + 클릭으로 점 추가 · 점 Alt+클릭으로 삭제</p>
                    </>
                  ) : (
                    <>
                      <Field label="종류(kind)" value={String(sel.properties.kind ?? '')} onChange={(v) => updateProp('kind', v)} />
                      <NumberField label="크기(size)" value={sel.properties.size} onChange={(v) => updateProp('size', v)} />
                      <NumberField label="값(value)" value={sel.properties.value} onChange={(v) => updateProp('value', v)} />
                    </>
                  )}
                  <div className="row">
                    <label>형태</label>
                    <span>{sel.properties.prim === 'flow' ? '흐름' : sel.geometry.type}</span>
                  </div>
                  <button className="delete-btn" onClick={() => selIdx != null && deleteFeature(selIdx)}>
                    <Trash size={15} />
                    피처 삭제 (Del)
                  </button>
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

function SliderField({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>
        {label} · {value}
      </span>
      <Slider.Root
        className="slider"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v!)}
      >
        <Slider.Track className="slider-track">
          <Slider.Range className="slider-range" />
        </Slider.Track>
        <Slider.Thumb className="slider-thumb" aria-label={label} />
      </Slider.Root>
    </label>
  );
}

function KindSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="field">
      <span>종류(kind) · {value || '미지정'}</span>
      <div className="swatches">
        {Object.entries(DEFAULT_THEME.layers).map(([k, color]) => (
          <button
            key={k}
            type="button"
            className={`swatch${value === k ? ' on' : ''}`}
            title={k}
            style={{ background: color }}
            onClick={() => onChange(k)}
          />
        ))}
      </div>
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <Switch.Root className="switch" checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}

// ── 지오메트리 ↔ 화면 px (hit-test / 선택 하이라이트) ──────────────
type Pt = [number, number];
type Geom = LayerFeature['geometry'];

const projAll = (coords: Pt[], gi: GeoInstance): Pt[] =>
  coords.map((c) => gi.project(c[0], c[1])).filter((p): p is Pt => p != null);

/** geometry 를 화면 px 의 폴리라인 묶음 + 정점 목록으로. project 불가 점(globe 뒷면)은 제외. */
function geomToPx(geom: Geom, gi: GeoInstance): { lines: Pt[][]; points: Pt[] } {
  if (geom.type === 'Point') {
    const p = gi.project(geom.coordinates[0], geom.coordinates[1]);
    return { lines: [], points: p ? [p] : [] };
  }
  if (geom.type === 'MultiPoint') {
    return { lines: [], points: projAll(geom.coordinates as Pt[], gi) };
  }
  if (geom.type === 'LineString') {
    const l = projAll(geom.coordinates as Pt[], gi);
    return { lines: [l], points: l };
  }
  // Polygon
  const rings = (geom.coordinates as Pt[][]).map((r) => projAll(r, gi));
  return { lines: rings, points: rings.flat() };
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function inPoly(px: number, py: number, pts: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 화면 px (px,py) 와 피처의 거리. 면 내부면 0. project 불가 시 null. */
function distToFeature(geom: Geom, px: number, py: number, gi: GeoInstance): number | null {
  const { lines, points } = geomToPx(geom, gi);
  let best: number | null = null;
  for (const [x, y] of points) {
    const d = Math.hypot(px - x, py - y);
    if (best == null || d < best) best = d;
  }
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const d = segDist(px, py, line[i - 1]!, line[i]!);
      if (best == null || d < best) best = d;
    }
  }
  if (geom.type === 'Polygon') {
    for (const ring of lines) if (ring.length >= 3 && inPoly(px, py, ring)) return 0;
  }
  return best;
}

const ACCENT = '#3fb6ab';

const handleSvg = (vtx: number | null, x: number, y: number): string =>
  `<circle class="vtx"${vtx == null ? '' : ` data-vtx="${vtx}"`} cx="${x}" cy="${y}" r="5" fill="#0b1018" stroke="${ACCENT}" stroke-width="2"/>`;

/** 세그먼트 중점의 '+' 고스트 핸들(제어점 추가용). */
const midHandleSvg = (seg: number, x: number, y: number): string =>
  `<g class="vtx-add" data-mid="${seg}"><circle data-mid="${seg}" cx="${x}" cy="${y}" r="6" fill="#0b1018" fill-opacity="0.6" stroke="${ACCENT}" stroke-opacity="0.55" stroke-width="1.5"/>` +
  `<path data-mid="${seg}" d="M${x - 3},${y} H${x + 3} M${x},${y - 3} V${y + 3}" stroke="${ACCENT}" stroke-width="1.5" stroke-linecap="round"/></g>`;

/**
 * 선택 피처의 외곽선 + 정점 핸들을 px SVG 문자열로.
 * 흐름(isFlow)이면 core 와 동일한 카디널 스플라인으로 곡선 미리보기.
 * LineString 핸들은 제어점 인덱스(data-vtx)를 보존해 드래그 대상이 된다.
 */
function highlightSvg(geom: Geom, gi: GeoInstance, isFlow = false, showHandles = true): string {
  const isLine = geom.type === 'LineString';
  let s = '';
  // 외곽선
  if (isFlow && isLine) {
    const ctrl = geom.coordinates as Pt[];
    if (ctrl.length >= 2) {
      const px = projAll(cardinalSpline(ctrl), gi);
      if (px.length >= 2) {
        const d = px.map((p) => `${p[0]},${p[1]}`).join(' ');
        s += `<polyline points="${d}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
    }
  } else {
    const { lines } = geomToPx(geom, gi);
    const closed = geom.type === 'Polygon';
    for (const line of lines) {
      if (line.length < 2) continue;
      const d = line.map((p) => `${p[0]},${p[1]}`).join(' ');
      s += closed
        ? `<polygon points="${d}" fill="rgba(63,182,171,0.12)" stroke="${ACCENT}" stroke-width="3" stroke-linejoin="round"/>`
        : `<polyline points="${d}" fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
  }
  // 제어점 핸들 — LineString 은 인덱스 보존(드래그 대상), 그 외는 인덱스 없이.
  // showHandles=false(지구본 보기)면 외곽선만 그리고 핸들은 생략(편집 불가).
  if (showHandles && isLine) {
    const ctrl = geom.coordinates as Pt[];
    // 흐름이면 세그먼트 중점에 '+' 추가 핸들(제어점 핸들 아래에 깔아 우선순위 양보).
    if (isFlow) {
      for (let k = 0; k < ctrl.length - 1; k++) {
        const a = gi.project(ctrl[k]![0], ctrl[k]![1]);
        const b = gi.project(ctrl[k + 1]![0], ctrl[k + 1]![1]);
        if (a && b) s += midHandleSvg(k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
    }
    for (let k = 0; k < ctrl.length; k++) {
      const p = gi.project(ctrl[k]![0], ctrl[k]![1]);
      if (p) s += handleSvg(k, p[0], p[1]);
    }
  } else if (showHandles) {
    const { points } = geomToPx(geom, gi);
    for (const [x, y] of points) s += handleSvg(null, x, y);
  }
  return s;
}
