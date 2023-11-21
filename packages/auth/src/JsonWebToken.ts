import jsonwebtoken, { JwtPayload, Jwt } from "jsonwebtoken";
import { expressjwt } from 'express-jwt';

export const JsonWebToken = {
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
    } as jsonwebtoken.VerifyOptions,
  },

  sign: function (payload: any, options: jsonwebtoken.SignOptions = {}) {
    return new Promise<string>((resolve, reject) => {
      if (options.algorithm === undefined) {
        options.algorithm = JsonWebToken.settings.verify.algorithms[0];
      }

      jsonwebtoken.sign(payload, JsonWebToken.settings.secret, options, (err, token) => {
        if (err) reject(err.message);
        resolve(token);
      });
    });
  },

  verify: function (token: string, options: jsonwebtoken.VerifyOptions = JsonWebToken.settings.verify) {
    return new Promise<JwtPayload | Jwt | string>((resolve, reject) => {
      jsonwebtoken.verify(token, JsonWebToken.settings.secret, options, function (err, decoded) {
        if (err) reject(err);
        resolve(decoded);
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
  middleware(params?: Partial<Parameters<typeof expressjwt>[0]>) {
    if (!JsonWebToken.settings.secret) {
      console.error("❌ Please provide 'JWT_SECRET' environment variable, or set 'JsonWebToken.options.secret'.");
    }

    return expressjwt(Object.assign({
      secret: JsonWebToken.settings.secret,
      // credentialsRequired: false,
      algorithms: JsonWebToken.settings.verify.algorithms,
      ...JsonWebToken.settings.verify,
    }, params));
  },
};