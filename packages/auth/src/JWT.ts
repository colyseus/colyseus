import jsonwebtoken, { JwtPayload, Jwt, VerifyOptions } from 'jsonwebtoken';
import { expressjwt } from 'express-jwt';

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

  verify: function<T = JwtPayload | Jwt | string> (token: string, options?: VerifyOptions) {
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
    return expressjwt(Object.assign({
      secret: getJWTSecret(),
      // credentialsRequired: false,
      algorithms: JWT.settings.verify.algorithms,
      ...JWT.settings.verify,
    }, params));
  },
};

function getJWTSecret() {
  JWT.settings.secret ||= process.env.JWT_SECRET;

  if (!JWT.settings.secret) {
    console.error("❌ Please provide 'JWT_SECRET' environment variable, or set 'JWT.settings.secret'.");
  }

  return JWT.settings.secret;
}