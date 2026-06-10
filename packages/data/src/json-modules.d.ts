/**
 * world-atlas 의 거대한 topojson JSON 을 TypeScript 가 리터럴 타입으로 추론하면
 * tsc 메모리/시간이 폭증한다. unknown 으로 받아 런타임에서 좁힌다.
 */
declare module 'world-atlas/countries-110m.json' {
  const value: unknown;
  export default value;
}
declare module 'world-atlas/countries-50m.json' {
  const value: unknown;
  export default value;
}
