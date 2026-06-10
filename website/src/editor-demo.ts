import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  GEOINSIGHT_NODE_NAME,
  GeoInsightExtension,
  geoInsightNodeToMarkdown,
} from '@geoinsight/host-tiptap';
import { PRESETS } from './presets.js';

/**
 * Tiptap 에디터 연동 데모.
 *
 * methii 와 동일한 경로: GeoInsightExtension 을 vanilla Tiptap 에디터에 등록하면
 * ```geoinsight 펜스가 geoinsightBlock 노드로 파싱되고, NodeView 가 @geoinsight/runtime
 * 의 인터랙티브 맵을 문서 안에 마운트한다. 우측에서 DSL 을 편집하면 블록이 실시간
 * 갱신되고, "마크다운 내보내기" 로 펜스 round-trip 을 확인할 수 있다.
 */
export function mountEditorDemo(host: HTMLElement): () => void {
  host.innerHTML = `
    <div class="ed">
      <section class="ed-doc">
        <div class="ed-toolbar">
          <span class="ed-label">문서</span>
          <select id="ed-insert">
            <option value="">+ 지도 블록 삽입…</option>
          </select>
          <button id="ed-export">마크다운 내보내기</button>
        </div>
        <div class="ed-surface" id="ed-surface"></div>
      </section>
      <section class="ed-side">
        <div class="ed-side-block">
          <div class="ed-label">첫 지도 블록 DSL <span class="muted">(편집하면 실시간 반영)</span></div>
          <textarea id="ed-dsl" spellcheck="false"></textarea>
        </div>
        <div class="ed-side-block ed-export-pane">
          <div class="ed-label">마크다운 출력 <span class="muted">(round-trip)</span></div>
          <pre id="ed-md"></pre>
        </div>
      </section>
    </div>
  `;

  const surface = host.querySelector<HTMLElement>('#ed-surface')!;
  const dslArea = host.querySelector<HTMLTextAreaElement>('#ed-dsl')!;
  const insertSel = host.querySelector<HTMLSelectElement>('#ed-insert')!;
  const exportBtn = host.querySelector<HTMLButtonElement>('#ed-export')!;
  const mdPane = host.querySelector<HTMLPreElement>('#ed-md')!;

  const initialDsl = PRESETS[0]!.source;
  // 초기 콘텐츠는 ProseMirror JSON 으로 직접 구성 — HTML 파싱 시 codeBlock 과의
  // 경쟁을 피하고 geoinsightBlock 노드를 확실히 만든다.
  const initialContent = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'GeoInsight × Tiptap' }] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '아래 지도는 @geoinsight/host-tiptap 익스텐션이 렌더한 geoinsightBlock 노드입니다. methii 같은 호스트가 @geoinsight/tiptap 번들을 통해 동일하게 연동합니다.',
          },
        ],
      },
      { type: GEOINSIGHT_NODE_NAME, content: [{ type: 'text', text: initialDsl }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '휠/드래그로 지도를 탐색하고, 오른쪽에서 DSL 을 편집해 보세요.' }],
      },
    ],
  };

  const editor = new Editor({
    element: surface,
    extensions: [StarterKit, GeoInsightExtension.configure({ theme: 'dark' })],
    content: initialContent,
  });

  // ── 첫 지도 블록 찾기/편집 ──
  const findFirstBlock = (): { pos: number; size: number; text: string } | null => {
    let found: { pos: number; size: number; text: string } | null = null;
    editor.state.doc.forEach((node, offset) => {
      if (!found && node.type.name === GEOINSIGHT_NODE_NAME) {
        found = { pos: offset, size: node.content.size, text: node.textContent };
      }
    });
    return found;
  };

  const replaceFirstBlock = (dsl: string): void => {
    const block = findFirstBlock();
    if (!block) return;
    const from = block.pos + 1;
    const to = block.pos + 1 + block.size;
    const { state, view } = editor;
    const tr = dsl
      ? state.tr.replaceWith(from, to, state.schema.text(dsl))
      : state.tr.delete(from, to);
    view.dispatch(tr);
  };

  let dslTimer: ReturnType<typeof setTimeout> | null = null;
  const onDslInput = () => {
    if (dslTimer) clearTimeout(dslTimer);
    dslTimer = setTimeout(() => replaceFirstBlock(dslArea.value), 200);
  };
  dslArea.addEventListener('input', onDslInput);

  // 문서 변경 시 textarea 동기화 (편집 중이 아닐 때만)
  const syncDsl = () => {
    if (document.activeElement === dslArea) return;
    const block = findFirstBlock();
    dslArea.value = block ? block.text : '';
  };
  editor.on('transaction', syncDsl);
  dslArea.value = initialDsl;

  // ── 프리셋 삽입 ──
  for (const preset of PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.source;
    opt.textContent = preset.label;
    insertSel.appendChild(opt);
  }
  const onInsert = () => {
    const source = insertSel.value;
    if (!source) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: GEOINSIGHT_NODE_NAME, content: [{ type: 'text', text: source }] })
      .run();
    insertSel.value = '';
  };
  insertSel.addEventListener('change', onInsert);

  // ── 마크다운 내보내기 (펜스 round-trip) ──
  const onExport = () => {
    const parts: string[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name === GEOINSIGHT_NODE_NAME) {
        const height = typeof node.attrs.height === 'number' ? node.attrs.height : undefined;
        parts.push(geoInsightNodeToMarkdown(node.textContent, height ? { height } : undefined).trimEnd());
      } else if (node.type.name === 'heading') {
        parts.push('#'.repeat(node.attrs.level ?? 1) + ' ' + node.textContent);
      } else {
        parts.push(node.textContent);
      }
    });
    mdPane.textContent = parts.join('\n\n');
  };
  exportBtn.addEventListener('click', onExport);
  onExport();

  return () => {
    if (dslTimer) clearTimeout(dslTimer);
    editor.destroy();
    host.innerHTML = '';
  };
}
