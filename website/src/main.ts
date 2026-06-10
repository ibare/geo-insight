import './style.css';
import '@geoinsight/runtime/styles.css';
import { mount, type GeoInstance } from '@geoinsight/runtime';
import type { Diagnostic } from '@geoinsight/core';
import { PRESETS } from './presets.js';

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <h1>GeoInsight</h1>
    <span class="tag">지도를 위한 Mermaid — 시맨틱 DSL → 결정적 SVG</span>
    <div class="presets" id="presets"></div>
  </header>
  <main>
    <section class="editor">
      <textarea id="src" spellcheck="false"></textarea>
      <div class="diagnostics" id="diag"></div>
    </section>
    <section class="preview">
      <div class="toolbar">
        <button id="reset">전체 보기</button>
      </div>
      <div class="map" id="map" data-geoinsight-root="true"></div>
      <div class="hint">휠: 줌 · 드래그: 팬</div>
    </section>
  </main>
`;

const textarea = document.getElementById('src') as HTMLTextAreaElement;
const mapEl = document.getElementById('map') as HTMLElement;
const diagEl = document.getElementById('diag') as HTMLElement;
const presetsEl = document.getElementById('presets') as HTMLElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;

let instance: GeoInstance | null = null;

function renderDiagnostics(diags: Diagnostic[]): void {
  diagEl.innerHTML = diags
    .map((d) => {
      const loc = d.span ? ` (line ${d.span.line})` : '';
      const sugg = d.suggestions?.length ? ` <span class="sugg">— 제안: ${d.suggestions.join(', ')}</span>` : '';
      return `<div class="diag ${d.level}">[${d.level}]${loc} ${escapeHtml(d.message)}${sugg}</div>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(source: string): void {
  if (!instance) {
    instance = mount(mapEl, source, {
      interactive: true,
      onDiagnostics: renderDiagnostics,
    });
  } else {
    instance.update(source);
    const result = instance.getResult();
    if (result) renderDiagnostics(result.diagnostics);
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
textarea.addEventListener('input', () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => render(textarea.value), 200);
});

resetBtn.addEventListener('click', () => instance?.reset());

// 프리셋 버튼
for (const preset of PRESETS) {
  const btn = document.createElement('button');
  btn.textContent = preset.label;
  btn.addEventListener('click', () => {
    textarea.value = preset.source;
    render(preset.source);
  });
  presetsEl.appendChild(btn);
}

// 초기 로드 — 첫 프리셋
textarea.value = PRESETS[0]!.source;
render(PRESETS[0]!.source);
