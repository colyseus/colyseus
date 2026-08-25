/**
 * Largest value a 32-bit signed Postgres `integer` column can hold
 * (2^31 - 1).
 *
 * A room's `maxClients` of `Infinity` can't be stored in an integer
 * column, so the database-backed matchmaking drivers cap it to this
 * sentinel on persist. Consumers reading the room cache (e.g. the admin
 * panel) should treat a `maxClients` of exactly this value as
 * "unlimited / ∞" rather than a literal cap.
 *
 * Kept in its own dependency-free module so it can be re-exported from
 * the package entry point without pulling the driver module graph into
 * the main bundle.
 */
export const POSTGRES_MAX_INTEGER = 2147483647;
