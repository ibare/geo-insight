// @ts-check
/**
 * @geoinsight/tiptap — rollup 설정.
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
 *  - @geoinsight/core: DSL→IR→SVG 컴파일러.
 *  - @geoinsight/data: 지오메트리 + resolver (world-atlas/world-countries 번들 JSON 포함).
 *  - @geoinsight/runtime: vanilla 줌/팬 마운트.
 *  - @geoinsight/host-tiptap: tiptap glue.
 */
function manualChunks(id) {
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
    manualChunks,
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
