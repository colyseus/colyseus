import { and, eq, sql } from 'drizzle-orm';

export interface Item {
  id: string;
  name: string;
  kind: string;
  meta?: any;
}

export interface PlayerItem {
  userId: string;
  itemId: string;
  qty: number;
  acquiredAt: Date;
}

export class ItemsService {
  private db: any;
  private items: any;
  private playerItems: any;

  constructor(db: any, items: any, playerItems: any) {
    this.db = db;
    this.items = items;
    this.playerItems = playerItems;
  }

  /**
   * Idempotently register an item in the catalog.
   * Re-running with the same id updates the name/kind/meta.
   */
  async defineItem(id: string, name: string, kind = 'misc', meta?: any): Promise<void> {
    await this.db
      .insert(this.items)
      .values({ id, name, kind, meta })
      .onConflictDoUpdate({
        target: this.items.id,
        set: { name, kind, meta },
      });
  }

  /**
   * Grant `qty` of an item to a user. Adds to existing quantity if the user
   * already owns the item.
   */
  async grant(userId: string, itemId: string, qty = 1): Promise<void> {
    await this.db
      .insert(this.playerItems)
      .values({ userId, itemId, qty, acquiredAt: new Date() })
      .onConflictDoUpdate({
        target: [this.playerItems.userId, this.playerItems.itemId],
        set: { qty: sql`${this.playerItems.qty} + ${qty}` },
      });
  }

  /**
   * Remove `qty` from a user's holding. Deletes the row if quantity reaches 0.
   * No-op if the user doesn't own the item.
   */
  async revoke(userId: string, itemId: string, qty = 1): Promise<void> {
    const current = await this.db
      .select({ qty: this.playerItems.qty })
      .from(this.playerItems)
      .where(and(
        eq(this.playerItems.userId, userId),
        eq(this.playerItems.itemId, itemId),
      ))
      .limit(1);

    if (!current[0]) { return; }

    const next = current[0].qty - qty;
    if (next <= 0) {
      await this.db
        .delete(this.playerItems)
        .where(and(
          eq(this.playerItems.userId, userId),
          eq(this.playerItems.itemId, itemId),
        ));
    } else {
      await this.db
        .update(this.playerItems)
        .set({ qty: next })
        .where(and(
          eq(this.playerItems.userId, userId),
          eq(this.playerItems.itemId, itemId),
        ));
    }
  }

  /** Every item the user currently owns. */
  async listForUser(userId: string): Promise<PlayerItem[]> {
    return await this.db
      .select()
      .from(this.playerItems)
      .where(eq(this.playerItems.userId, userId));
  }
}
