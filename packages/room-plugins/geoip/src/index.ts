export { GeoIPPlugin, type GeoIPPluginOptions } from './GeoIPPlugin.ts';
export type { GeoIPData, GeoIPReader } from './types.ts';
export { MMDBReader } from './readers/MMDBReader.ts';
export { AutoDownloader, type AutoDownloaderOptions } from './readers/AutoDownloader.ts';

import type { GeoIPData } from './types.ts';

declare module '@colyseus/core' {
  interface Client {
    /**
     * Country-level geo data resolved from the client's IP at auth time.
     * Populated by `GeoIPPlugin`; undefined when the IP can't be resolved
     * (loopback, private range, or not in the database).
     */
    geoip?: GeoIPData;
  }
}
