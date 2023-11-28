import crypto from 'crypto';

export class Hash {

  /**
   * Hashes a password using SHA1 + process.env.AUTH_SALT.
   * @param password Password to be hashed
   * @returns Hashed password
   */
  static make(password: string, salt: string = process.env.AUTH_SALT) {
    return crypto.createHash("sha1").update(password + salt).digest("hex");
  }

}