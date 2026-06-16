import './style.css';
import '@geo-insight/runtime/styles.css';
import { mountPlayground } from './playground.js';
import { mountEditorDemo } from './editor-demo.js';

type ViewId = 'playground' | 'editor';
const VIEWS: Array<{ id: ViewId; label: string; mount: (el: HTMLElement) => () => void }> = [
  { id: 'playground', label: '플레이그라운드', mount: mountPlayground },
  { id: 'editor', label: 'Tiptap 에디터', mount: mountEditorDemo },
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <h1>GeoInsight</h1>
    <span class="tag">지도를 위한 Mermaid — 시맨틱 DSL → 결정적 SVG</span>
    <nav class="tabs" id="tabs"></nav>
  </header>
  <div class="view" id="view"></div>
`;

const tabsEl = document.getElementById('tabs')!;
const viewEl = document.getElementById('view') as HTMLElement;

let cleanup: (() => void) | null = null;
let active: ViewId = 'playground';

function show(id: ViewId): void {
  if (cleanup) cleanup();
  active = id;
  if (location.hash !== `#${id}`) location.hash = id;
  const view = VIEWS.find((v) => v.id === id)!;
  cleanup = view.mount(viewEl);
  tabsEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === id);
  });
}

for (const v of VIEWS) {
  const btn = document.createElement('button');
  btn.textContent = v.label;
  btn.dataset.id = v.id;
  btn.addEventListener('click', () => {
    if (v.id !== active) show(v.id);
  });
  tabsEl.appendChild(btn);
}

const initial: ViewId = location.hash === '#editor' ? 'editor' : 'playground';
show(initial);
