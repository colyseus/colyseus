import { eq, desc, and } from 'drizzle-orm';
import type { UserNotesTableShape } from '../types.ts';

export interface UserNote {
  id: string;
  userId: string;
  authorId: string | null;
  text: string;
  createdAt: Date;
}

/**
 * Operator-authored annotations attached to a user. Append-only by
 * convention — the service exposes `add`, `list`, `delete`, but no
 * `update`. That keeps the trail of past observations stable; if a
 * note no longer applies, write a new one rather than rewriting
 * history.
 *
 * Example use:
 *   await db.notes.add(userId, 'Refunded once 2026-04-12 — flagged by L2', operator.id);
 *   const all = await db.notes.list(userId);     // newest first
 *   await db.notes.delete(noteId);
 */
export class NotesService<T extends UserNotesTableShape = UserNotesTableShape> {
  private db: any;
  private notes: T;

  constructor(db: any, notes: T) {
    this.db = db;
    this.notes = notes;
  }

  /**
   * Add a new note for `userId`. Returns the created row (id +
   * createdAt populated by drizzle's defaults).
   */
  async add(userId: string, text: string, authorId?: string | null): Promise<UserNote> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('[NotesService.add] text must not be empty');
    }
    const [row] = await this.db
      .insert(this.notes)
      .values({ userId, authorId: authorId ?? null, text: trimmed })
      .returning();
    return row as UserNote;
  }

  /**
   * Notes for a user, newest first. Tie-breaks on id (descending) so
   * notes added in the same second still surface in a stable order —
   * sqlite's `unixepoch()` only has second precision.
   */
  async list(userId: string, opts: { limit?: number } = {}): Promise<UserNote[]> {
    const limit = opts.limit ?? 100;
    return this.db
      .select()
      .from(this.notes)
      .where(eq(this.notes.userId, userId))
      .orderBy(desc(this.notes.createdAt), desc(this.notes.id))
      .limit(limit) as Promise<UserNote[]>;
  }

  /** Delete a single note by id. Idempotent — missing ids are a no-op. */
  async delete(noteId: string): Promise<void> {
    await this.db.delete(this.notes).where(eq(this.notes.id, noteId));
  }

  /** Delete every note for a user — used by GDPR data deletion. */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.delete(this.notes).where(eq(this.notes.userId, userId));
  }
}
