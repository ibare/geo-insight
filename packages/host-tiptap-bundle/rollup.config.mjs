// @ts-check
/**
 * @geo-insight/tiptap — rollup 설정.
 *
 * 정책 (참고 프로젝트 @trama-chain/tiptap 미러):
 *  - 단일 ESM entry (tiptap.js) + 자동 chunk 추론.
 *  - external: @tiptap/core, @tiptap/pm — 호스트(메티) 단일 인스턴스 보장.
 *    React/DOM 의존은 없다 (runtime 은 vanilla DOM) — peer 는 @tiptap 둘뿐.
 *  - manualChunks: geoinsight-core / runtime / geoinsight-data 로 의미 분리.
 *  - CSS: runtime 의 styles.css 를 postcss 로 펼친 뒤 inject:true 로 번들 import
 *    시점에 head 에 <style> 1회 삽입. geoinsight-* prefix 로 호스트 전역과 충돌 차단.
 *  - .d.ts 는 별도 패스(rollup-plugin-dts)로 단일 dist/tiptap.d.ts.
 *  - sourcemap: true. VISUALIZE=1 일 때 stats.html.
 */

import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import dynamicImportVars from '@rollup/plugin-dynamic-import-vars';
import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import postcss from 'rollup-plugin-postcss';
import postcssImport from 'postcss-import';
import { visualizer } from 'rollup-plugin-visualizer';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const VISUALIZE = process.env.VISUALIZE === '1';

const external = [/^@tiptap\/core/, /^@tiptap\/pm(\/.*)?$/];

/**
 * chunk 의미 분리. id 는 절대 경로로 들어옴.
 *  - @geo-insight/core: DSL→IR→SVG 컴파일러.
 *  - @geo-insight/data: 지오메트리 + resolver (world-atlas/world-countries 번들 JSON 포함).
 *  - @geo-insight/runtime: vanilla 줌/팬 마운트.
 *  - @geo-insight/host-tiptap: tiptap glue.
 */
function manualChunks(id) {
  // 국가별 ADM1 지오메트리 JSON 은 묶지 말 것 — 동적 import 로 분해된 lazy 청크를
  // 유지해 요청한 국가만 로드되게 한다(전부 한 청크로 합치면 5.5MB 가 항상 로드됨).
  // (게이저티어 adm1-index.json 은 assets/adm1/ 가 아니라 assets/ 직속이라 data 청크에 남음.)
  if (/\/packages\/data\/assets\/adm1\//.test(id)) return undefined;
  if (/\/packages\/data\//.test(id)) return 'geoinsight-data';
  if (/\/packages\/core\//.test(id)) return 'geoinsight-core';
  if (/\/packages\/runtime\//.test(id)) return 'runtime';
  if (/\/packages\/host-tiptap\//.test(id)) return 'runtime';
  return undefined;
}

function chunkFileName(info) {
  const name = info.name ?? 'chunk';
  return `chunks/${name}-[hash].js`;
}

const jsBundle = {
  input: 'src/index.ts',
  external,
  output: {
    dir: 'dist',
    format: 'es',
    entryFileNames: 'tiptap.js',
    chunkFileNames: chunkFileName,
    inlineDynamicImports: false,
    sourcemap: true,
    generatedCode: 'es2015',
    // manualChunks 미사용 — 234개 ADM1 동적 import 가 생긴 뒤로는 강제 그룹핑이
    // 동적 경계와 충돌해 world-atlas/world-countries 를 여러 청크에 4× 복제했다.
    // rollup 기본 알고리즘이 공유 모듈을 1개 청크로 dedup 하도록 맡긴다.
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: { 'process.env.NODE_ENV': JSON.stringify('production') },
    }),
    nodeResolve({ extensions: ['.ts', '.tsx', '.mjs', '.js'], preferBuiltins: false }),
    commonjs(),
    json(),
    postcss({
      plugins: [
        postcssImport({
          resolve(id, basedir) {
            if (id.startsWith('.') || id.startsWith('/') || path.isAbsolute(id)) {
              return path.resolve(basedir, id);
            }
            try {
              return require.resolve(id, { paths: [basedir] });
            } catch {
              return id;
            }
          },
        }),
      ],
      extract: false,
      inject: true,
      minimize: true,
    }),
    esbuild({ target: 'es2022', sourceMap: true, tsconfig: '../../tsconfig.base.json' }),
    // esbuild(TS→JS) 뒤에 실행 — loadAdm1Browser 의 import(`../assets/adm1/${ccn3}.json`)
    // 를 국가별 lazy 청크로 분해(Vite 가 기본 내장하는 것을 rollup 번들에서도 동일하게).
    dynamicImportVars({ warnOnError: true }),
    VISUALIZE &&
      visualizer({ filename: 'stats.html', template: 'treemap', gzipSize: true, brotliSize: true }),
  ].filter(Boolean),
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
    warn(warning);
  },
};

const dtsBundle = {
  input: 'src/index.ts',
  external: [...external, /\.css$/],
  output: { file: 'dist/tiptap.d.ts', format: 'es' },
  plugins: [dts({ respectExternal: true })],
};

export default [jsBundle, dtsBundle];
