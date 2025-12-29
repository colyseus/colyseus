import jsonwebtoken, { type JwtPayload, type Jwt, type VerifyOptions } from 'jsonwebtoken';
import { expressjwt } from 'express-jwt';
import { APIError, createMiddleware, type MiddlewareOptions, type MiddlewareInputContext } from '@colyseus/better-call';
import type { Request, Response, NextFunction } from 'express';

export type { VerifyOptions, Jwt, JwtPayload };

/**
 * Type for the JWT auth middleware that works with both Express and better-call
 * Note: The better-call signature must be last for ReturnType to infer correctly
 */
export type JWTAuthMiddleware<T = JwtPayload> =
  ((req: Request, res: Response, next: NextFunction) => void) &
  { options: MiddlewareOptions } &
  ((ctx: MiddlewareInputContext<MiddlewareOptions>) => Promise<{ auth: T }>);

export const JWT = {
  settings: {
    /**
     * The secret used to sign and verify the JWTs.
     */
    secret: undefined as jsonwebtoken.Secret,

    verify: {
      /**
       * The first algorithm in the list is used to sign new tokens.
       */
      algorithms: ['HS256'],
    } as VerifyOptions,
  },

  sign: function (payload: any, options: jsonwebtoken.SignOptions = {}) {
    return new Promise<string>((resolve, reject) => {
      if (options.algorithm === undefined) {
        options.algorithm = JWT.settings.verify.algorithms[0];
      }

      jsonwebtoken.sign(payload, getJWTSecret(), options, (err, token) => {
        if (err) reject(err.message);
        resolve(token);
      });
    });
  },

  verify: function <T = JwtPayload | Jwt | string>(token: string, options?: VerifyOptions) {
    return new Promise<T>((resolve, reject) => {
      jsonwebtoken.verify(token, getJWTSecret(), options || JWT.settings.verify, function (err, decoded) {
        if (err) reject(err);
        resolve(decoded as T);
      });
    });
  },

  /**
   * Returns the decoded payload without verifying if the signature is valid
   */
  decode: jsonwebtoken.decode,

  /**
   * Middleware that verifies JsonWebTokens.
   * Works with both Express and better-call.
   *
   * Example (express):
   *   app.get("/protected_route", auth.middleware(), (req, res) => { ... });
   *
   * Example (better-call):
   *   const protectedRoute = createEndpoint("/protected-route", {
   *     method: "GET",
   *     use: [auth.middleware()],
   *   }, async (ctx) => {
   *     // ctx.context.auth contains the decoded JWT payload
   *   });
   */
  middleware: function <T = JwtPayload>(options?: VerifyOptions): JWTAuthMiddleware<T> {
    const expressjwtMiddleware = expressjwt(Object.assign({
      secret: getJWTSecret(),
      algorithms: JWT.settings.verify.algorithms,
      ...JWT.settings.verify,
    }, options)) as (req: Request, res: Response, next: NextFunction) => void;

    const betterCallMiddleware = createMiddleware<{}, { auth: T }>(async (ctx) => {
      const authHeader = ctx.getHeader('authorization');

      if (!authHeader) {
        throw new APIError(401, { message: 'No authorization header' });
      }

      const [scheme, token] = authHeader.split(' ');

      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        throw new APIError(401, { message: 'Invalid authorization header format' });
      }

      try {
        const decoded = await JWT.verify<T>(token, options);
        return { auth: decoded };
      } catch (err: any) {
        throw new APIError(401, { message: err.message || 'Invalid token' });
      }
    });

    // Create wrapper function that works with both Express and better-call
    const middleware = function (reqOrCtx: any, res?: Response, next?: NextFunction) {
      if (arguments.length === 3) {
        // Express middleware: (req, res, next)
        return expressjwtMiddleware(reqOrCtx, res!, next!);
      } else {
        // better-call middleware: (ctx)
        return betterCallMiddleware(reqOrCtx);
      }
    };

    // Copy over the options property for better-call middleware compatibility
    (middleware as any).options = (betterCallMiddleware as any).options;

    return middleware as JWTAuthMiddleware<T>;
  },
};

function getJWTSecret() {
  JWT.settings.secret ||= process.env.JWT_SECRET;

  if (!JWT.settings.secret) {
    console.error("❌ Please provide 'JWT_SECRET' environment variable, or set 'JWT.settings.secret'.");
  }

  return JWT.settings.secret;
}