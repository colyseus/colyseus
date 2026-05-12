import { eq, sql, type InferSelectModel } from 'drizzle-orm';
import { generateId } from '@colyseus/core';
import type { AuthSettings } from '@colyseus/auth';
import type { UsersTableShape } from '../types.ts';
import type { ServiceDb } from './_db.ts';

/**
 * `T` is the user's actual users-table type. By default it's
 * `UsersTableShape` (the constraint itself, types loose to AnyColumn). When
 * a user passes their own table to GameDatabase — e.g. one with
 * `displayName` and `level` extras — `T` flows in via GameDatabase's
 * generic, and `findByEmail()` returns the full row including those
 * extras.
 */
export class AuthService<T extends UsersTableShape = UsersTableShape> {
  private db: ServiceDb;
  private users: T;

  constructor(db: ServiceDb, users: T) {
    this.db = db;
    this.users = users;
  }

  /**
   * Returns an AuthSettings-compatible object to pass to auth.routes().
   *
   *   import { auth } from '@colyseus/auth';
   *   auth.routes(db.auth.settings);
   */
  get settings(): Partial<AuthSettings> {
    return {
      onFindUserByEmail: this.findByEmail.bind(this),
      onRegisterWithEmailAndPassword: this.registerWithEmail.bind(this),
      onRegisterAnonymously: this.registerAnonymous.bind(this),
      onResetPassword: this.resetPassword.bind(this),
      onOAuthProviderCallback: this.oauthCallback.bind(this),
    };
  }

  /**
   * Find user by email. Returns the user with `password` field mapped from
   * `passwordHash`, as expected by @colyseus/auth (auth.ts line 219).
   *
   * Return type includes whatever columns the user added to their custom
   * `users` table — `InferSelectModel<T>` resolves them.
   */
  private async findByEmail(email: string): Promise<(InferSelectModel<T> & { password: any }) | null> {
    const rows = await this.db
      .select()
      .from(this.users)
      .where(eq(this.users.email, email))
      .limit(1);

    if (!rows[0]) { return null; }

    // Reject banned users at the auth boundary so a banned user can't
    // sign in even if their session expires. The login flow surfaces
    // this as plain "invalid credentials" today — distinguishing
    // "you're banned until X" needs upstream @colyseus/auth wiring.
    const row = rows[0] as any;
    if (row.bannedUntil && new Date(row.bannedUntil).getTime() > Date.now()) {
      return null;
    }

    const user = { ...rows[0] };
    // @colyseus/auth checks user.password — map from passwordHash
    user.password = user.passwordHash;
    return user;
  }

  /**
   * Throw a clear error when a ban-related method is invoked but the
   * user's custom `users` table doesn't include the ban columns.
   * `bannedUntil` / `bannedReason` are optional on UsersTableShape so
   * pre-bans schemas keep type-checking; this is the runtime side of
   * that contract.
   */
  private requireBanColumns(method: string): void {
    const u = this.users as any;
    if (!u.bannedUntil || !u.bannedReason) {
      throw new Error(
        `[AuthService.${method}] users table is missing 'bannedUntil' / 'bannedReason' columns. ` +
        `Spread \`...columns.{sqlite|pg}.users\` from '@colyseus/database' into your custom users ` +
        `table (or include them manually) to enable bans.`,
      );
    }
  }

  /**
   * Ban a user. `until` defaults to a far-future timestamp (effectively
   * permanent). The next sign-in attempt is rejected via findByEmail
   * while bannedUntil > now.
   */
  async ban(userId: string, opts: { reason?: string; until?: Date | null } = {}): Promise<void> {
    this.requireBanColumns('ban');
    // Permanent bans use a far-future sentinel so the same `> now()`
    // check in findByEmail handles both timed and permanent bans. Year
    // 9999 fits inside both PG's TIMESTAMP and sqlite's INTEGER (unix
    // epoch in seconds) — JS Date.MAX_VALUE overflows PG.
    const PERMANENT = new Date(Date.UTC(9999, 11, 31));
    const until = opts.until === undefined ? PERMANENT : (opts.until ?? PERMANENT);
    await this.db
      .update(this.users)
      .set({
        bannedUntil: until,
        bannedReason: opts.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * Read the current token revocation counter for a user. Returns `0`
   * for unknown users (and when the column isn't on the schema) so
   * the auth guard's comparison degrades to "accept" rather than
   * "reject" — old custom schemas keep authenticating.
   */
  async getTokenVersion(userId: string): Promise<number> {
    const u = this.users as any;
    if (!u.tokenVersion) { return 0; }
    const rows = await this.db
      .select({ tv: u.tokenVersion })
      .from(this.users)
      .where(eq(this.users.id, userId))
      .limit(1);
    return Number(rows[0]?.tv ?? 0);
  }

  /**
   * Increment the user's token version, invalidating every JWT issued
   * before this call. Use for password changes, "sign out everywhere",
   * and forced-rotation after suspected compromise. Safe to call on
   * schemas that don't carry the column — silently no-ops so the
   * caller doesn't need to feature-detect.
   */
  async bumpTokenVersion(userId: string): Promise<void> {
    const u = this.users as any;
    if (!u.tokenVersion) { return; }
    await this.db
      .update(this.users)
      .set({
        tokenVersion: sql`${u.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /** Lift a ban (clears bannedUntil + bannedReason). Idempotent. */
  async unban(userId: string): Promise<void> {
    this.requireBanColumns('unban');
    await this.db
      .update(this.users)
      .set({
        bannedUntil: null,
        bannedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * Current ban state for a user. Returns `{ banned: false }` for
   * unknown users — callers shouldn't lock-out missing players. Returns
   * `{ banned: false }` (without throwing) when the users table doesn't
   * carry ban columns at all — the read path is meant to be safe to
   * call on any schema, so probing apps don't have to special-case.
   */
  async isBanned(
    userId: string,
    at: Date = new Date(),
  ): Promise<{ banned: true; reason: string | null; until: Date } | { banned: false }> {
    const u = this.users as any;
    if (!u.bannedUntil) { return { banned: false }; }
    const rows = await this.db
      .select({
        bannedUntil: u.bannedUntil,
        bannedReason: u.bannedReason,
      })
      .from(this.users)
      .where(eq(this.users.id, userId))
      .limit(1);
    const row = rows[0] as any;
    if (!row || !row.bannedUntil) { return { banned: false }; }
    const until = row.bannedUntil instanceof Date ? row.bannedUntil : new Date(row.bannedUntil);
    if (until.getTime() <= at.getTime()) { return { banned: false }; }
    return { banned: true, reason: row.bannedReason ?? null, until };
  }

  /**
   * Register with email and password.
   * The password is already hashed by @colyseus/auth before reaching here.
   * Handles anonymous→email upgrade via options.upgradingToken.
   */
  private async registerWithEmail(
    email: string,
    hashedPassword: string,
    options: { upgradingToken?: any },
  ) {
    // Anonymous → email upgrade
    if (options?.upgradingToken) {
      const tokenData = options.upgradingToken as any;
      const userId = tokenData.id || tokenData.anonymousId;

      if (userId) {
        await this.db
          .update(this.users)
          .set({
            email,
            passwordHash: hashedPassword,
            anonymous: false,
            updatedAt: new Date(),
          })
          .where(eq(this.users.id, userId));
        return;
      }
    }

    // Normal registration
    await this.db
      .insert(this.users)
      .values({
        id: generateId(21),
        email,
        passwordHash: hashedPassword,
        anonymous: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  /**
   * Register anonymous user. Returns the created user data (included in JWT).
   */
  private async registerAnonymous(options?: any) {
    const id = generateId(21);
    const anonymousId = generateId(21);

    const values = {
      id,
      anonymousId,
      anonymous: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.insert(this.users).values(values);

    return { id, anonymousId, anonymous: true, ...options };
  }

  /**
   * Reset password. The new password is already hashed by @colyseus/auth.
   */
  private async resetPassword(email: string, hashedPassword: string) {
    await this.db
      .update(this.users)
      .set({
        passwordHash: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(this.users.email, email));
  }

  /**
   * Set a user's password hash by id (not email — used by the admin
   * panel's reset flow where the userId is carried in the reset JWT).
   * Pre-hashed input expected; pair with `@colyseus/auth`'s `Hash.make`.
   */
  async setPasswordHash(userId: string, hashedPassword: string): Promise<void> {
    await this.db
      .update(this.users)
      .set({
        passwordHash: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * OAuth provider callback. Creates or finds user based on OAuth profile.
   * Handles anonymous→OAuth upgrade via data.upgradingToken.
   */
  private async oauthCallback(data: any, provider: string) {
    const profile = data.profile || data;
    const email = profile.email || profile.email_verified;

    // Try to upgrade anonymous user if token present
    if (data.upgradingToken) {
      const tokenData = data.upgradingToken as any;
      const userId = tokenData.id || tokenData.anonymousId;

      if (userId && email) {
        await this.db
          .update(this.users)
          .set({
            email,
            anonymous: false,
            updatedAt: new Date(),
          })
          .where(eq(this.users.id, userId));

        const rows = await this.db
          .select()
          .from(this.users)
          .where(eq(this.users.id, userId))
          .limit(1);

        return rows[0] || null;
      }
    }

    // Find existing user by email
    if (email) {
      const rows = await this.db
        .select()
        .from(this.users)
        .where(eq(this.users.email, email))
        .limit(1);

      if (rows[0]) { return rows[0]; }
    }

    // Create new user from OAuth profile
    const id = generateId(21);
    const values = {
      id,
      email: email || null,
      anonymous: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.insert(this.users).values(values);

    return { ...values };
  }
}
