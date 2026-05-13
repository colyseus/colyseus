/**
 * Coloured badge for an audit-log `action` value, used in two places:
 *
 *   - the standalone /admin/adminAudit list table (via `formatCell`,
 *     which routes any column literally named `action` through here),
 *   - the user show page's Audit timeline.
 *
 * Color cues:
 *   - destructive (red): `user.ban`, `delete`, `room.dispose`, `room.kick`
 *   - success (green): `user.unban`
 *   - secondary (muted): `user.revoke_sessions`, `update`, `auth.*`,
 *     `room.lock`, `room.unlock`, `room.state.edit`
 *   - outline (neutral): anything we don't recognise, including custom
 *     game-specific actions
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';

const DESTRUCTIVE = new Set([
  'user.ban',
  'delete',
  'room.dispose',
  'room.kick',
  'room.state.delete',
]);
const SUCCESS = new Set([
  'user.unban',
]);
const SECONDARY_PREFIXES = ['auth.'];
const SECONDARY = new Set([
  'user.revoke_sessions',
  'update',
  'create',
  'room.lock',
  'room.unlock',
  'room.state.edit',
]);

export function AuditActionBadge({ action }: { action: string }) {
  let variant: 'destructive' | 'success' | 'secondary' | 'outline' = 'outline';
  if (DESTRUCTIVE.has(action)) {
    variant = 'destructive';
  } else if (SUCCESS.has(action)) {
    variant = 'success';
  } else if (SECONDARY.has(action) || SECONDARY_PREFIXES.some((p) => action.startsWith(p))) {
    variant = 'secondary';
  }
  return <Badge variant={variant} className="font-mono">{action}</Badge>;
}
