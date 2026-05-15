import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const getDirname = () => (typeof __dirname !== 'undefined') ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export const htmlTemplatePath = [
  path.join(process.cwd(), 'html'),
  path.join(getDirname(), '..', 'html'),
].find((filePath) => existsSync(filePath));

export async function readTemplate(name: string): Promise<string> {
  return await fs.readFile(path.join(htmlTemplatePath!, name), 'utf-8');
}
