import { eq, type InferSelectModel } from 'drizzle-orm';
import { generateId } from '@colyseus/core';
import type { AuthSettings } from '@colyseus/auth';
import type { UsersTableShape } from '../types.ts';

/**
 * `T` is the user's actual users-table type. By default it's
 * `UsersTableShape` (the constraint itself, types loose to AnyColumn). When
 * a user passes their own table to GameDatabase — e.g. one with
 * `displayName` and `level` extras — `T` flows in via GameDatabase's
 * generic, and `findByEmail()` returns the full row including those
 * extras.
 */
export class AuthService<T extends UsersTableShape = UsersTableShape> {
  private db: any;
  private users: T;

  constructor(db: any, users: T) {
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

    const user = { ...rows[0] };
    // @colyseus/auth checks user.password — map from passwordHash
    user.password = user.passwordHash;
    return user;
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
