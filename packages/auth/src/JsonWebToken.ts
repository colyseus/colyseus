import jsonwebtoken, { JwtPayload, Jwt } from "jsonwebtoken";
import { expressjwt } from 'express-jwt';

export const JsonWebToken = {
  options: {
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
        options.algorithm = JsonWebToken.options.verify.algorithms[0];
      }

      jsonwebtoken.sign(payload, this.options.secret, options, (err, token) => {
        if (err) reject(err);
        resolve(token);
      });
    });
  },

  verify: function (token: string, options: jsonwebtoken.VerifyOptions = this.options.verify) {
    return new Promise<JwtPayload | Jwt | string>((resolve, reject) => {
      jsonwebtoken.verify(token, this.options.secret, options, function (err, decoded) {
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
    if (!this.options.secret) {
      console.error("❌ Please provide 'JWT_SECRET' environment variable, or set 'jwt.options.secret'.");
    }

    return expressjwt(Object.assign({
      secret: this.options.secret,
      // credentialsRequired: false,
      algorithms: this.options.verify.algorithms,
      ...this.options.verify,
    }, params));
  },
};