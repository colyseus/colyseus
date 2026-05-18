import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const getDirname = () => (typeof __dirname !== 'undefined') ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export const htmlTemplatePath = [
  path.join(process.cwd(), 'html'),
  path.join(getDirname(), '..', 'html'),
].find((filePath) => existsSync(filePath));

/**
 * Read an HTML email/page template. Pass `fallback` to fall back to a
 * second template when `name` is absent (ENOENT only) — used so
 * `@colyseus/admin` can prefer a consumer-provided
 * `admin-reset-password-email.html` and otherwise reuse the standard
 * `reset-password-email.html`. Non-ENOENT errors still propagate.
 */
export async function readTemplate(name: string, fallback?: string): Promise<string> {
  try {
    return await fs.readFile(path.join(htmlTemplatePath!, name), 'utf-8');
  } catch (err: any) {
    if (fallback && err?.code === 'ENOENT') {
      return await fs.readFile(path.join(htmlTemplatePath!, fallback), 'utf-8');
    }
    throw err;
  }
}
