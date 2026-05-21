/**
 * Country-level geo data attached to a Client by `GeoIPPlugin`.
 *
 * Fields mirror MMDB record shape but are reduced to what's reliably
 * present across MaxMind GeoLite2-Country and DB-IP Lite. Anything richer
 * (city, lat/lon, ASN) belongs in a dedicated reader.
 */
export interface GeoIPData {
  /** ISO 3166-1 alpha-2 country code, e.g. "BR", "US". */
  isoCode: string;
  /** Human-readable English name, e.g. "Brazil". */
  name: string;
  /** ISO 3166-1 continent code: AF, AN, AS, EU, NA, OC, SA. */
  continent?: string;
  /** EU member flag — present in MaxMind country records, useful for GDPR routing. */
  isInEU?: boolean;
}

/**
 * Pluggable reader contract. Implementations wrap a specific MMDB-style
 * database. The plugin only depends on this shape, which keeps mode
 * swapping (user-path / auto-download / bundled) cheap.
 */
export interface GeoIPReader {
  /** Resolve an IPv4/IPv6 string to country data, or undefined when unknown. */
  lookup(ip: string): GeoIPData | undefined;
  /** Release any held resources (file descriptors, timers). */
  close?(): void | Promise<void>;
}
