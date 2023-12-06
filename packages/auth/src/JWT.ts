import jsonwebtoken, { JwtPayload, Jwt, VerifyOptions } from 'jsonwebtoken';
import { expressjwt } from 'express-jwt';

export type { VerifyOptions, Jwt, JwtPayload };

export const JWT = {
  settings: {
    /**
     * The secret used to sign and verify the JWTs.
     */
    secret: process.env.JWT_SECRET as jsonwebtoken.Secret,

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

      jsonwebtoken.sign(payload, JWT.settings.secret, options, (err, token) => {
        if (err) reject(err.message);
        resolve(token);
      });
    });
  },

  verify: function<T = JwtPayload | Jwt | string> (token: string, options?: VerifyOptions) {
    if (!options) {
      options = JWT.settings.verify;
    }
    return new Promise<T>((resolve, reject) => {
      jsonwebtoken.verify(token, JWT.settings.secret, options, function (err, decoded) {
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
  middleware: function(params?: Partial<Parameters<typeof expressjwt>[0]>) {
    if (!JWT.settings.secret) {
      console.error("❌ Please provide 'JWT_SECRET' environment variable, or set 'JWT.settings.secret'.");
    }

    return expressjwt(Object.assign({
      secret: JWT.settings.secret,
      // credentialsRequired: false,
      algorithms: JWT.settings.verify.algorithms,
      ...JWT.settings.verify,
    }, params));
  },
};