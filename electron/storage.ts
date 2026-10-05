import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import type { Scan } from '../shared/types';

export class Storage {
  constructor(private root: string) {}
  async read<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.root, `${name}.json`), 'utf8'));
    } catch {
      return fallback;
    }
  }
  async write(name: string, value: unknown) {
    await mkdir(this.root, { recursive: true });
    const dest = join(this.root, `${name}.json`);
    const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await rename(tmp, dest);
  }
  authStorage = {
    getItem: async (key: string) => {
      const value = await this.read<string | null>(
        `auth-${Buffer.from(key).toString('hex')}`,
        null,
      );
      if (!value) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        return safeStorage.decryptString(Buffer.from(value, 'base64'));
      } catch {
        return null;
      }
    },
    setItem: async (key: string, value: string) => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          'Secure credential storage is unavailable. Enable your system keychain and restart Repo Run.',
        );
      await this.write(
        `auth-${Buffer.from(key).toString('hex')}`,
        safeStorage.encryptString(value).toString('base64'),
      );
    },
    removeItem: async (key: string) => {
      await unlink(join(this.root, `auth-${Buffer.from(key).toString('hex')}.json`)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
    },
  };
  async scans(userId: string): Promise<Scan[]> {
    return this.read(`history-${userId}`, []);
  }
  async saveScan(userId: string, scan: Scan) {
    const scans = await this.scans(userId);
    await this.write(
      `history-${userId}`,
      [scan, ...scans.filter((s) => s.id !== scan.id)].slice(0, 100),
    );
  }
}
