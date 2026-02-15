import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { Router } from 'express';
import { existsSync } from 'fs';
import { debugAndPrintError, generateId, logger, matchMaker } from '@colyseus/core';
import { type Request } from 'express-jwt';
import { type OAuthProviderCallback, oAuthProviderCallback, oauth } from './oauth.ts';
import { JWT, type JwtPayload } from './JWT.ts';
import { Hash } from './Hash.ts';

export type MayHaveUpgradeToken = { upgradingToken?: JwtPayload };

export type RegisterWithEmailAndPasswordCallback<T = any> = (email: string, password: string, options: T & MayHaveUpgradeToken) => Promise<unknown>;
export type RegisterAnonymouslyCallback<T = any> = (options: T) => Promise<unknown>;
export type FindUserByEmailCallback = (email: string) => Promise<unknown & { password: string }>;

export type SendEmailConfirmationCallback = (email: string, html: string, confirmLink: string) => Promise<unknown>;
export type EmailConfirmedCallback = (email: string) => Promise<unknown>;

export type ForgotPasswordCallback = (email: string, html: string, resetLink: string) => Promise<boolean | unknown>;
export type ResetPasswordCallback = (email: string, password: string) => Promise<unknown>;

export type ParseTokenCallback = (token: JwtPayload) => Promise<unknown> | unknown;
export type GenerateTokenCallback = (userdata: unknown) => Promise<unknown>;
export type HashPasswordCallback = (password: string) => Promise<string>;

export interface AuthSettings {
  onFindUserByEmail: FindUserByEmailCallback,
  onRegisterWithEmailAndPassword: RegisterWithEmailAndPasswordCallback,
  onRegisterAnonymously: RegisterAnonymouslyCallback,

  onSendEmailConfirmation?: SendEmailConfirmationCallback,
  onEmailConfirmed?: EmailConfirmedCallback,

  onForgotPassword?: ForgotPasswordCallback,
  onResetPassword?: ResetPasswordCallback,

  onOAuthProviderCallback?: OAuthProviderCallback,
  onParseToken?: ParseTokenCallback,
  onGenerateToken?: GenerateTokenCallback,
  onHashPassword?: HashPasswordCallback,
};

let onFindUserByEmail: FindUserByEmailCallback = (email: string) => { throw new Error('`auth.settings.onFindUserByEmail` not implemented.'); };
let onRegisterWithEmailAndPassword: RegisterWithEmailAndPasswordCallback = () => { throw new Error('`auth.settings.onRegisterWithEmailAndPassword` not implemented.'); };
let onForgotPassword: ForgotPasswordCallback = () => { throw new Error('`auth.settings.onForgotPassword` not implemented.'); };
let onParseToken: ParseTokenCallback = (jwt: JwtPayload) => jwt;
let onGenerateToken: GenerateTokenCallback = async (userdata: unknown) => await JWT.sign(userdata);
let onHashPassword: HashPasswordCallback = async (password: string) => Hash.make(password);

/**
 * Detect HTML template path (for password reset form)
 */
// __dirname is not available in ESM
const getDirname = () => (typeof __dirname !== 'undefined') ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const htmlTemplatePath = [
  path.join(process.cwd(), "html"),
  path.join(getDirname(), "..", "html"),
].find((filePath) => existsSync(filePath));

const RESET_PASSWORD_TOKEN_EXPIRATION_MINUTES = 30;

export const auth = {
  /**
   * Backend URL (used for OAuth callbacks and email confirmation links)
   */
  backend_url: "",

  /**
   * OAuth utilities
   */
  oauth: oauth,

  settings: {
    /**
     * Find user by email.
     */
    onFindUserByEmail,

    /**
     * Register user by email and password.
     */
    onRegisterWithEmailAndPassword,

    /**
     * (Optional) Register anonymous user.
     */
    onRegisterAnonymously: undefined as RegisterAnonymouslyCallback,

    /**
     * (Optional) Send email address verification confirmation email.
     */
    onSendEmailConfirmation: undefined as SendEmailConfirmationCallback,

    /**
     * (Optional) Send email address verification confirmation email.
     */
    onEmailConfirmed: undefined as EmailConfirmedCallback,

    /**
     * (Optional) Send reset password link via email.
     */
    onForgotPassword,

    /**
     * (Optional) Reset password action.
     */
    onResetPassword: undefined as ResetPasswordCallback,

    /**
     * By default, it returns the contents of the JWT token. (onGenerateToken)
     */
    onParseToken,

    /**
     * By default, it encodes the full `userdata` object into the JWT token.
     */
    onGenerateToken,

    /**
     * Hash password before storing it. By default, it uses SHA1 + process.env.AUTH_SALT.
     */
    onHashPassword,
  } as AuthSettings,

  prefix: "/auth",

  /**
   * Middleware that verifies JsonWebTokens.
   * Works with both Express and better-call.
   *
   * Express: sets `req.auth`
   * better-call: decoded JWT payload is available in `ctx.context.auth`
   */
  middleware: JWT.middleware,

  routes: function (settings: Partial<AuthSettings> = {}): Router {
    if (process.env.NODE_ENV !== 'production') {
      // do not warn in production
      console.warn(`
  @colyseus/auth API's are in beta and may change in the future.
  Please give feedback and report any issues you may find at https://github.com/colyseus/colyseus/issues/660
      `);
    }

    const router = express.Router();

    //
    // Auto-detect backend URL from the first request, if not defined.
    // (We do only once to reduce chances of 'Host' header injection vulnerability)
    //
    const originDetector: any = function (req, _, next) {
      if (!auth.backend_url) {
        auth.backend_url = req.protocol + '://' + req.get('host');
      }
      if (!oauth.defaults.origin) {
        oauth.defaults.origin = auth.backend_url;
      }
      // remove this middleware from the stack
      const stackIndex = router.stack.indexOf(originDetector);
      if (stackIndex !== -1) { router.stack.splice(stackIndex, 1); }
      next();
    };
    router.use(originDetector);

    // set register/login callbacks
    Object.keys(settings).forEach(key => {
      auth.settings[key] = settings[key];
    });

    if (!auth.settings.onParseToken) {
      auth.settings.onParseToken = onParseToken;
    }
    if (!auth.settings.onGenerateToken) {
      auth.settings.onGenerateToken = onGenerateToken;
    }
    if (!auth.settings.onHashPassword) {
      auth.settings.onHashPassword = onHashPassword;
    }

    /**
     * OAuth (optional)
     */
    if (settings.onOAuthProviderCallback) {
      oauth.onCallback(settings.onOAuthProviderCallback);
    }

    if (oAuthProviderCallback) {
      const prefix = oauth.prefix;

      // make sure oauth.prefix contains the full prefix
      oauth.prefix = auth.prefix + prefix;

      router.use(prefix, oauth.routes());
    }

    /**
     * Get user data from JWT token.
     */
    router.get("/userdata", auth.middleware(), async (req: Request, res) => {
      try {
        res.json({ user: await auth.settings.onParseToken(req.auth), });
      } catch (e: any) {
        res.status(401).json({ error: e.message });
      }
    });

    /**
     * Login user by email and password.
     */
    router.post("/login", express.json(), async (req, res) => {
      try {
        const email = req.body.email;
        if (!isValidEmail(email)) { throw new Error("email_malformed"); }

        const user = Object.assign({}, await auth.settings.onFindUserByEmail(email));
        if (user && user.password === await Hash.make(req.body.password)) {
          delete user.password; // remove password from JWT payload
          res.json({ user, token: await auth.settings.onGenerateToken(user) });

        } else {
          throw new Error("invalid_credentials");
        }

      } catch (e: any) {
        logger.error(e);
        res.status(401).json({ error: e.message });
      }
    });

    /**
     * Register user by email and password.
     * - auth.middleware() is used here to allow upgrading anonymous users.
     */
    router.post("/register", express.json(), async (req: Request, res) => {
      const email = req.body.email;
      const password = req.body.password;

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "email_malformed" });
      }

      let existingUser: any;
      try {
        existingUser = await auth.settings.onFindUserByEmail(email)

      } catch (e: any) {
        logger.error('@colyseus/auth, onFindUserByEmail exception:' + e.stack);
      }

      try {
        // TODO: allow to set password on existing user, if valid token is equivalent to email
        //  (existingUser.password && existingUser.password.length > 0)
        if (existingUser) {
          throw new Error("email_already_in_use");
        }

        if (!isValidPassword(password)) {
          return res.status(400).json({ error: "password_too_short" });
        }

        // Build options
        const options: MayHaveUpgradeToken = req.body.options || {};

        // Verify Authorization header, if present.
        if (req.headers.authorization) {
          const authHeader = req.headers.authorization;
          const authToken = (authHeader.startsWith("Bearer ") && authHeader.substring(7, authHeader.length)) || undefined;
          options.upgradingToken = await JWT.verify(authToken);
        }

        // Register
        await auth.settings.onRegisterWithEmailAndPassword(email, await Hash.make(password), options);

        const user = Object.assign({}, await auth.settings.onFindUserByEmail(email));
        delete user.password; // remove password from JWT payload

        const token = await auth.settings.onGenerateToken(user);

        // Call `onSendEmailConfirmation` callback, if defined.
        if (typeof (auth.settings.onSendEmailConfirmation) === "function") {
          const confirmEmailLink = `${auth.backend_url}${auth.prefix}/confirm-email?token=${token}`;
          const html = (await fs.readFile(path.join(htmlTemplatePath, "address-confirmation-email.html"), "utf-8"))
            .replace("[LINK]", confirmEmailLink);

          await auth.settings.onSendEmailConfirmation(email, html, confirmEmailLink);
        }

        res.json({ user, token, });

      } catch (e: any) {
        logger.error(e);
        res.status(401).json({ error: e.message });
      }
    });

    router.get("/confirm-email", async (req, res) => {
      if (req.query.success || req.query.error) {
        const html = await fs.readFile(path.join(htmlTemplatePath, "address-confirmation.html"), "utf-8");
        return res.end(html);
      }

      // send "address confirmed" message
      if (typeof (auth.settings.onEmailConfirmed) !== "function") {
        return res.status(404).end('Not found.');
      }

      try {
        const token = (req.query.token || "").toString();
        const data = await JWT.verify<{ email: string }>(token);

        await auth.settings.onEmailConfirmed(data.email);
        res.redirect(auth.prefix + "/confirm-email?success=" + encodeURIComponent("Email confirmed successfully!"));

      } catch (e: any) {
        res.redirect(auth.prefix + "/confirm-email?error=" + e.message);
      }
    });

    /**
     * Anonymous sign-in
     */
    router.post("/anonymous", express.json(), async (req, res) => {
      try {
        const options = (req.body || {}).options;

        // register anonymous user, if callback is defined.
        const user = (auth.settings.onRegisterAnonymously)
          ? await auth.settings.onRegisterAnonymously(options)
          : { ...options, id: undefined, anonymousId: generateId(21), anonymous: true }

        res.json({
          user,
          token: await auth.settings.onGenerateToken(user)
        });
      } catch (e: any) {
        debugAndPrintError(e);
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/forgot-password", express.json(), async (req, res) => {
      try {
        //
        // check if "forgot password" feature is fully implemented
        //
        if (typeof (auth.settings.onForgotPassword) !== "function") {
          throw new Error("auth.settings.onForgotPassword must be implemented.");
        }

        if (typeof (auth.settings.onResetPassword) !== "function") {
          throw new Error("auth.settings.onResetPassword must be implemented.");
        }

        const email = req.body.email;
        const user = await auth.settings.onFindUserByEmail(email);
        if (!user) {
          throw new Error("email_not_found");
        }

        const token = await JWT.sign({ email }, { expiresIn: `${RESET_PASSWORD_TOKEN_EXPIRATION_MINUTES}m` });
        const passwordResetLink = `${auth.backend_url}${auth.prefix}/reset-password?token=${token}`;
        const html = (await fs.readFile(path.join(htmlTemplatePath, "reset-password-email.html"), "utf-8"))
          .replace("[LINK]", passwordResetLink);

        const result = (await auth.settings.onForgotPassword(email, html, passwordResetLink)) ?? true;
        res.json(result);

      } catch (e: any) {
        debugAndPrintError(e);
        res.status(401).json({ error: e.message });
      }
    });

    // reset password form
    router.get("/reset-password", async (req, res) => {
      try {
        const token = (req.query.token || "").toString();

        const htmlForm = (await fs.readFile(path.join(htmlTemplatePath, "reset-password-form.html"), "utf-8"))
          .replace("[ACTION]", auth.prefix + "/reset-password")
          .replace("[TOKEN]", token);

        res
          .set("content-type", "text/html")
          .send(htmlForm);

      } catch (e: any) {
        logger.debug(e);
        res.end(`Error: ${e.message}`);
      }
    });

    // reset password form ACTION
    router.post("/reset-password", express.urlencoded({ extended: false }), async (req, res) => {
      const token = req.body.token;
      const password = req.body.password;

      try {
        const data = await JWT.verify<{ email: string }>(token);

        if (matchMaker.presence?.get("reset-password:" + token)) {
          throw new Error("token_already_used");
        }

        if (!isValidPassword(password)) {
          throw new Error("Password is too short.");
        }

        const result = await auth.settings.onResetPassword(data.email, await Hash.make(password)) ?? true;

        if (!result) {
          throw new Error("Could not reset password.");
        }

        // invalidate used token for 30m
        matchMaker.presence?.setex("reset-password:" + token, "1", 60 * RESET_PASSWORD_TOKEN_EXPIRATION_MINUTES);

        res.redirect(auth.prefix + "/reset-password?success=" + encodeURIComponent("Password reset successfully!"));

      } catch (e: any) {
        res.redirect(auth.prefix + "/reset-password?token=" + token + "&error=" + e.message);
      }
    });

    return router;
  },
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)
}

function isValidPassword(password: string) {
  return password.length >= 6;
}
