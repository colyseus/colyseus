import fs from 'fs';
import { Reader, type CountryResponse, type Response } from 'maxmind';

import type { GeoIPData, GeoIPReader } from '../types.ts';

/**
 * Sync MMDB reader — loads the whole file into memory and answers
 * `lookup()` in microseconds. Compatible with both MaxMind GeoLite2-Country
 * and DB-IP Lite Country since they share the MMDB binary format and
 * expose the same `country` / `continent` record shape.
 *
 * For the auto-downloader path, the reader is re-instantiated when a
 * fresh database is fetched; old instances are dropped to GC.
 */
export class MMDBReader implements GeoIPReader {
  private reader: Reader<Response>;

  constructor(dbPath: string) {
    const buffer = fs.readFileSync(dbPath);
    this.reader = new Reader<Response>(buffer);
  }

  lookup(ip: string): GeoIPData | undefined {
    let record: CountryResponse | null;
    try {
      record = this.reader.get(ip) as CountryResponse | null;
    } catch {
      // maxmind throws on malformed IPs; treat as unknown.
      return undefined;
    }
    if (!record || !record.country) { return undefined; }
    const country = record.country;
    return {
      isoCode: country.iso_code,
      name: country.names?.en ?? country.iso_code,
      continent: record.continent?.code,
      isInEU: country.is_in_european_union,
    };
  }
}
