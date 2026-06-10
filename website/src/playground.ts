import { mount, type GeoInstance } from '@geoinsight/runtime';
import type { Diagnostic } from '@geoinsight/core';
import { loadAdm1Browser } from '@geoinsight/data/browser';
import { PRESETS } from './presets.js';

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
        <div class="toolbar"><button id="pg-reset">전체 보기</button></div>
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
        // show 에 등장한 국가의 ADM1(주/도)을 lazy fetch — 'show: California' 등이 동작.
        loadAdm1: loadAdm1Browser,
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
