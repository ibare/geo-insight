import type { GeoApi } from '../../preload';

declare global {
  interface Window {
    geoApi: GeoApi;
  }
}

export {};
