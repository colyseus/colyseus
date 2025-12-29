import jsonwebtoken, { type JwtPayload, type Jwt, type VerifyOptions } from 'jsonwebtoken';
import { expressjwt } from 'express-jwt';
import { APIError } from '@colyseus/better-call';

export type { VerifyOptions, Jwt, JwtPayload };

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
   * Get express middleware that verifies JsonWebTokens and sets `req.auth`.
   */
  middleware: function (params?: Partial<Parameters<typeof expressjwt>[0]>): (req: any, res: any, next: any) => void {
    const expressMiddleware = expressjwt(Object.assign({
      secret: getJWTSecret(),
      // credentialsRequired: false,
      algorithms: JWT.settings.verify.algorithms,
      ...JWT.settings.verify,
    }, params));

    return function () {
      if (arguments.length === 3) {
        /**
         * using it via express
         *
         * Example:
         *   app.get("/protected_route", auth.middleware(), (req, res) => { ...
         */
        expressMiddleware(arguments[0], arguments[1], arguments[2]);

      } else {
        /**
         * using it via @colyseus/better-call
         *
         * Example:
         *   const protectedRoute = createEndpoint("/protected-route", {
         *     method: "GET",
         *     use: [auth.middleware()],
         *   }, async (ctx) => { ... });
         */
        return new Promise((resolve, reject) => {
          const ctx = arguments[0];

          // Create a request-like object for express-jwt
          // better-call's ctx.headers is a Headers instance, but express-jwt expects req.headers.authorization
          const requestProperty = params?.requestProperty || 'auth';
          const mockReq: any = {
            headers: {},
            [requestProperty]: undefined,
          };

          // Extract headers from better-call context
          if (ctx.headers instanceof Headers) {
            ctx.headers.forEach((value: string, key: string) => {
              mockReq.headers[key.toLowerCase()] = value;
            });
          } else if (ctx.headers) {
            mockReq.headers = ctx.headers;
          }

          try {
            expressMiddleware(mockReq, undefined, function (err: any) {
              if (err) {
                reject(new APIError(err.status || 401, { message: err.message }));
              } else {
                // Copy the auth property back to ctx
                ctx[requestProperty] = mockReq[requestProperty];
                resolve(mockReq[requestProperty]);
              }
            });
          } catch (e: any) {
            reject(new APIError(e.status || 500, { message: e.message }));
          }
        });

      }
    };
  },
};

function getJWTSecret() {
  JWT.settings.secret ||= process.env.JWT_SECRET;

  if (!JWT.settings.secret) {
    console.error("❌ Please provide 'JWT_SECRET' environment variable, or set 'JWT.settings.secret'.");
  }

  return JWT.settings.secret;
}