export type {
  Position,
  PolygonGeometry,
  MultiPolygonGeometry,
  CountryGeometry,
  GeoFeature,
  LineStringGeometry,
  MultiLineStringGeometry,
  LayerGeometry,
  LayerFeature,
  ResolveResult,
  Resolver,
  SearchHit,
  DataSource,
  Adm1IndexEntry,
  Adm1FeatureCollection,
} from './types.js';

export { createDefaultDataSource, rawCountries } from './countries.js';
export { createResolver, type ResolverOptions } from './resolver.js';
export { GROUP_DEFS, GROUP_BY_ALIAS, normalizeName, type GroupDef } from './groups.js';
export { ADM1_INDEX, adm1NameIndex, adm1InCountry, decodeAdm1 } from './adm1.js';
