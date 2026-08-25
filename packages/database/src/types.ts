/**
 * Table-shape constraints for each service.
 *
 * Each `…TableShape` is the minimum drizzle Table contract a service depends
 * on. Users who customize their schemas via `columns.{sqlite,pg}.*` (spread
 * the base columns, add fields) automatically satisfy these constraints —
 * fields they ADD are simply absent from the constraint and flow through to
 * service return types via `InferSelectModel<T>`.
 *
 * If a user defines a table missing a required column, TypeScript fails at
 * the GameDatabase constructor call with a precise message about the missing
 * field.
 */
import type { AnyColumn, Table } from 'drizzle-orm';

export type UsersTableShape = Table & {
  id: AnyColumn;
  email: AnyColumn;
  passwordHash: AnyColumn;
  anonymous: AnyColumn;
  anonymousId: AnyColumn;
  createdAt: AnyColumn;
  updatedAt: AnyColumn;
  // Ban-related columns. Required: AuthService.ban / unban / isBanned
  // all read or write these. Custom users tables must spread
  // `userColumns` (or include the columns explicitly).
  bannedUntil: AnyColumn;
  bannedReason: AnyColumn;
  // Session revocation counter. Required: AuthService.ban() and the
  // JWT revocation check both rely on it; custom users tables must
  // spread `userColumns` (or include the column explicitly).
  tokenVersion: AnyColumn;
};

export type ConfigsTableShape = Table & {
  key: AnyColumn;
  value: AnyColumn;
  version: AnyColumn;
  updatedAt: AnyColumn;
};

export type CloudSavesTableShape = Table & {
  userId: AnyColumn;
  slot: AnyColumn;
  version: AnyColumn;
  data: AnyColumn;
  createdAt: AnyColumn;
  updatedAt: AnyColumn;
};

export type LeaderboardsTableShape = Table & {
  id: AnyColumn;
  name: AnyColumn;
};

export type LeaderboardEntriesTableShape = Table & {
  boardId: AnyColumn;
  userId: AnyColumn;
  season: AnyColumn;
  score: AnyColumn;
  createdAt: AnyColumn;
};

export type AnalyticsEventsTableShape = Table & {
  id: AnyColumn;
  userId: AnyColumn;
  name: AnyColumn;
  props: AnyColumn;
  ts: AnyColumn;
};

export type RolesTableShape = Table & {
  userId: AnyColumn;
  role: AnyColumn;
  scopes: AnyColumn;
};

export type UserNotesTableShape = Table & {
  id: AnyColumn;
  userId: AnyColumn;
  authorId: AnyColumn;
  text: AnyColumn;
  createdAt: AnyColumn;
};

export type AdminAuditTableShape = Table & {
  id: AnyColumn;
  operatorId: AnyColumn;
  action: AnyColumn;
  resource: AnyColumn;
  targetId: AnyColumn;
  payload: AnyColumn;
  createdAt: AnyColumn;
};

/** All known schema slots — used as the base type for GameDatabaseOptions['schemas']. */
export interface SchemaSet {
  users: UsersTableShape;
  configs: ConfigsTableShape;
  cloudSaves: CloudSavesTableShape;
  leaderboards: LeaderboardsTableShape;
  leaderboardEntries: LeaderboardEntriesTableShape;
  analyticsEvents: AnalyticsEventsTableShape;
  roles: RolesTableShape;
  userNotes: UserNotesTableShape;
  adminAudit: AdminAuditTableShape;
}
