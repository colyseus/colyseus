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
  bannedUntil: AnyColumn;
  bannedReason: AnyColumn;
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

export type ItemsTableShape = Table & {
  id: AnyColumn;
  name: AnyColumn;
  kind: AnyColumn;
  meta: AnyColumn;
};

export type PlayerItemsTableShape = Table & {
  userId: AnyColumn;
  itemId: AnyColumn;
  qty: AnyColumn;
  acquiredAt: AnyColumn;
};

export type TimedEventsTableShape = Table & {
  id: AnyColumn;
  name: AnyColumn;
  startsAt: AnyColumn;
  endsAt: AnyColumn;
  payload: AnyColumn;
};

export type AnalyticsEventsTableShape = Table & {
  id: AnyColumn;
  userId: AnyColumn;
  name: AnyColumn;
  props: AnyColumn;
  ts: AnyColumn;
};

export type UserRolesTableShape = Table & {
  userId: AnyColumn;
  role: AnyColumn;
};

export type ModAssignmentsTableShape = Table & {
  userId: AnyColumn;
  collection: AnyColumn;
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

export type BannedAddressesTableShape = Table & {
  id: AnyColumn;
  kind: AnyColumn;
  value: AnyColumn;
  reason: AnyColumn;
  until: AnyColumn;
  createdBy: AnyColumn;
  createdAt: AnyColumn;
};

/** All known schema slots — used as the base type for GameDatabaseOptions['schemas']. */
export interface SchemaSet {
  users: UsersTableShape;
  configs: ConfigsTableShape;
  cloudSaves: CloudSavesTableShape;
  leaderboards: LeaderboardsTableShape;
  leaderboardEntries: LeaderboardEntriesTableShape;
  items: ItemsTableShape;
  playerItems: PlayerItemsTableShape;
  timedEvents: TimedEventsTableShape;
  analyticsEvents: AnalyticsEventsTableShape;
  userRoles: UserRolesTableShape;
  modAssignments: ModAssignmentsTableShape;
  userNotes: UserNotesTableShape;
  adminAudit: AdminAuditTableShape;
  bannedAddresses: BannedAddressesTableShape;
}
