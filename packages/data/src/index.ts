export type {
  Position,
  PolygonGeometry,
  MultiPolygonGeometry,
  CountryGeometry,
  GeoFeature,
  ResolveResult,
  Resolver,
  SearchHit,
  DataSource,
} from './types.js';

export { createDefaultDataSource, rawCountries } from './countries.js';
export { createResolver, type ResolverOptions } from './resolver.js';
export { GROUP_DEFS, GROUP_BY_ALIAS, normalizeName, type GroupDef } from './groups.js';
