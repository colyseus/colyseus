import crypto from 'crypto';

type HashPasswordAlgorihtm = (password: string, salt?: string) => Promise<string> | string;
type HashAlgorithm = "sha1" | "scrypt" | string;

export class Hash {
  static algorithm: HashAlgorithm = "scrypt";
  static algorithms: {[id: HashAlgorithm]: HashPasswordAlgorihtm} = {
    "sha1": (password: string, salt: string) => crypto.createHash("sha1").update(password + salt).digest("hex"),
    "scrypt": (password: string, salt: string) => new Promise<string>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) reject(err);
        resolve(derivedKey.toString('hex'));
      });
    }),
  };

  /**
   * Make a hash from a password
   *
   * @param password Password to be hashed
   * @param salt Password salt
   *
   * @returns Hashed password
   */
  static async make(password: string, salt: string = process.env.AUTH_SALT || "## SALT ##") {
    return await this.algorithms[this.algorithm](password, salt);
  }

}
