/**
 * Node 전용 로더 배럴 — '@geoinsight/data/node'.
 * ADM1 + 레이어 디스크 로더(node:fs 의존). 브라우저 번들에 넣지 말 것.
 */
export * from './adm1-fs.js';
export * from './layers-fs.js';
