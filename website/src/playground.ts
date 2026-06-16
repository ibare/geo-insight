import { mount, type GeoInstance } from '@geo-insight/runtime';
import { DEFAULT_FLOW_WIDTH_PARAMS, type Diagnostic, type FlowWidthParams } from '@geo-insight/core';
import { loadAdm1Browser, loadLayerBrowser } from '@geo-insight/data/browser';
import { PRESETS } from './presets.js';

/** 흐름 두께 튜닝 슬라이더 정의 — flow-width 파라미터를 라이브로 조절. */
const FLOW_PARAM_DEFS: Array<{ key: keyof FlowWidthParams; label: string; min: number; max: number; step: number }> = [
  { key: 'gamma', label: '줌 감도 γ (1=실폭, 0=고정)', min: 0, max: 1, step: 0.05 },
  { key: 'minPx', label: '최소 두께(px)', min: 0.5, max: 6, step: 0.5 },
  { key: 'maxPx', label: '최대 두께(px)', min: 4, max: 48, step: 1 },
  { key: 'hideBelowPx', label: '도형 가시 임계(px)', min: 0.5, max: 4, step: 0.25 },
  { key: 'fadeToPx', label: '도형 페이드 끝(px)', min: 1, max: 8, step: 0.25 },
  { key: 'labelHidePx', label: '라벨 가시 임계(px)', min: 1, max: 12, step: 0.5 },
  { key: 'labelFadePx', label: '라벨 페이드 끝(px)', min: 2, max: 16, step: 0.5 },
  { key: 'refPxPerKm', label: '기준 해상도(px/km)', min: 0.01, max: 0.2, step: 0.005 },
];

const FLOW_PARAMS_KEY = 'gi-flow-params';

function loadFlowParams(): FlowWidthParams {
  try {
    const raw = localStorage.getItem(FLOW_PARAMS_KEY);
    if (raw) return { ...DEFAULT_FLOW_WIDTH_PARAMS, ...(JSON.parse(raw) as Partial<FlowWidthParams>) };
  } catch {
    /* localStorage 미사용 환경 — 기본값 */
  }
  return { ...DEFAULT_FLOW_WIDTH_PARAMS };
}

function saveFlowParams(p: FlowWidthParams): void {
  try {
    localStorage.setItem(FLOW_PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* 무시 */
  }
}

/** 바닐라 runtime 플레이그라운드 — 좌측 DSL 에디터 + 우측 줌/팬 맵. */
export function mountPlayground(host: HTMLElement): () => void {
  host.innerHTML = `
    <div class="pg">
      <section class="editor">
        <div class="presets" id="pg-presets"></div>
        <textarea id="pg-src" spellcheck="false"></textarea>
        <div class="diagnostics" id="pg-diag"></div>
      </section>
      <section class="preview">
        <div class="toolbar">
          <button id="pg-reset">전체 보기</button>
          <button id="pg-flow-toggle">흐름 튜닝</button>
        </div>
        <div class="flow-tuner" id="pg-flow-tuner" hidden></div>
        <div class="map" id="pg-map" data-geoinsight-root="true"></div>
        <div class="hint">휠: 줌 · 드래그: 팬 · 국가 클릭: 추가 · 선택된 국가 클릭: 연결/제거 메뉴</div>
      </section>
    </div>
  `;

  const textarea = host.querySelector<HTMLTextAreaElement>('#pg-src')!;
  const mapEl = host.querySelector<HTMLElement>('#pg-map')!;
  const diagEl = host.querySelector<HTMLElement>('#pg-diag')!;
  const presetsEl = host.querySelector<HTMLElement>('#pg-presets')!;
  const resetBtn = host.querySelector<HTMLButtonElement>('#pg-reset')!;
  const tunerEl = host.querySelector<HTMLElement>('#pg-flow-tuner')!;
  const flowToggle = host.querySelector<HTMLButtonElement>('#pg-flow-toggle')!;

  const flowParams = loadFlowParams();
  let instance: GeoInstance | null = null;

  const renderDiagnostics = (diags: Diagnostic[]): void => {
    diagEl.innerHTML = diags
      .map((d) => {
        const loc = d.span ? ` (line ${d.span.line})` : '';
        const sugg = d.suggestions?.length
          ? ` <span class="sugg">— 제안: ${d.suggestions.join(', ')}</span>`
          : '';
        return `<div class="diag ${d.level}">[${d.level}]${loc} ${escapeHtml(d.message)}${sugg}</div>`;
      })
      .join('');
  };

  const render = (source: string): void => {
    if (!instance) {
      instance = mount(mapEl, source, {
        interactive: true,
        editable: true,
        // 흐름 두께 모델 파라미터(슬라이더로 라이브 튜닝).
        flowWidthParams: flowParams,
        // show 에 등장한 국가의 ADM1(주/도)을 lazy fetch — 'show: California' 등이 동작.
        loadAdm1: loadAdm1Browser,
        // 'layers: 해류' 등 켜진 레이어 지오메트리를 lazy fetch.
        loadLayer: loadLayerBrowser,
        // 지도 클릭으로 편집 시 textarea 동기화 (runtime 이 이미 재렌더 → update 호출 금지)
        onChange: (next) => {
          textarea.value = next;
        },
        onDiagnostics: renderDiagnostics,
      });
    } else {
      instance.update(source);
      const result = instance.getResult();
      if (result) renderDiagnostics(result.diagnostics);
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const onInput = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => render(textarea.value), 200);
  };
  textarea.addEventListener('input', onInput);
  resetBtn.addEventListener('click', () => instance?.reset());

  // ── 흐름 두께 튜닝 슬라이더 ──
  flowToggle.addEventListener('click', () => {
    tunerEl.hidden = !tunerEl.hidden;
  });
  for (const def of FLOW_PARAM_DEFS) {
    const row = document.createElement('label');
    row.className = 'flow-row';
    const span = document.createElement('span');
    span.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(flowParams[def.key]);
    const out = document.createElement('b');
    out.textContent = String(flowParams[def.key]);
    input.addEventListener('input', () => {
      flowParams[def.key] = Number.parseFloat(input.value);
      out.textContent = input.value;
      saveFlowParams(flowParams);
      instance?.setFlowParams({ ...flowParams });
    });
    row.append(span, input, out);
    tunerEl.appendChild(row);
  }

  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      textarea.value = preset.source;
      render(preset.source);
    });
    presetsEl.appendChild(btn);
  }

  textarea.value = PRESETS[0]!.source;
  render(PRESETS[0]!.source);

  return () => {
    if (timer) clearTimeout(timer);
    instance?.destroy();
    instance = null;
    host.innerHTML = '';
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
