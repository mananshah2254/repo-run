import type { Scan, HistoryResult } from '../shared/types';
import type { Auth } from './auth';
import type { Storage } from './storage';

// Upload only repository findings and relevant version results, never local paths or full system inventory.
export function cloudScan(scan: Scan): Scan {
  return { ...scan, machine: { ...scan.machine, release: '', tools: [] } };
}
export class History {
  constructor(
    private auth: Auth,
    private storage: Storage,
  ) {}
  async save(scan: Scan, expectedUserId: string) {
    const user = await this.auth.requireUser();
    if (user.id !== expectedUserId)
      throw new Error('Your account changed during the check. Please check the repository again.');
    await this.storage.saveScan(user.id, scan);
    const pending = await this.storage.read<string[]>(`pending-${user.id}`, []);
    await this.storage.write(`pending-${user.id}`, [...new Set([...pending, scan.id])]);
    return this.sync();
  }
  private async sync(): Promise<string | undefined> {
    const user = await this.auth.requireUser();
    const pending = await this.storage.read<string[]>(`pending-${user.id}`, []);
    const scans = await this.storage.scans(user.id);
    if (!pending.length) return;
    const rows = scans
      .filter((s) => pending.includes(s.id))
      .map((scan) => ({
        id: scan.id,
        user_id: user.id,
        repo_url: scan.repository.url,
        checked_at: scan.checkedAt,
        report: cloudScan(scan),
      }));
    if (!rows.length) return;
    const { error } = await this.auth.client!.from('repository_checks').upsert(rows);
    if (error)
      return 'Saved on this computer. Cloud sync is pending; check your connection and Supabase database setup.';
    const uploaded = new Set(rows.map((row) => row.id));
    await this.storage.write(
      `pending-${user.id}`,
      (await this.storage.read<string[]>(`pending-${user.id}`, [])).filter(
        (id) => !uploaded.has(id),
      ),
    );
  }
  async list(): Promise<HistoryResult> {
    const user = await this.auth.requireUser();
    const warning = await this.sync();
    const local = await this.storage.scans(user.id);
    const pendingIds = new Set(await this.storage.read<string[]>(`pending-${user.id}`, []));
    const { data, error } = await this.auth
      .client!.from('repository_checks')
      .select('report')
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(100);
    if (error)
      return {
        scans: local,
        warning: warning || 'Showing local history. Cloud history is currently unavailable.',
      };
    const merged = new Map<string, Scan>();
    for (const row of data || []) {
      const scan = row.report as Scan;
      if (
        scan?.id &&
        scan.repository?.url &&
        Array.isArray(scan.requirements) &&
        Array.isArray(scan.projects)
      )
        merged.set(scan.id, scan);
    }
    for (const scan of local)
      if (
        pendingIds.has(scan.id) ||
        (merged.has(scan.id) && merged.get(scan.id)!.checkedAt <= scan.checkedAt)
      )
        merged.set(scan.id, scan);
    const scans = [...merged.values()]
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
      .slice(0, 100);
    await this.storage.write(`history-${user.id}`, scans);
    return { scans, warning };
  }
  async get(id: string) {
    const user = await this.auth.requireUser();
    const scan = (await this.storage.scans(user.id)).find((s) => s.id === id);
    if (!scan) throw new Error('This check is no longer available. Check the repository again.');
    return scan;
  }
  async remove(id: string) {
    const user = await this.auth.requireUser();
    const { error } = await this.auth
      .client!.from('repository_checks')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw new Error('Could not delete cloud history. Please retry when connected.');
    await this.storage.write(
      `history-${user.id}`,
      (await this.storage.scans(user.id)).filter((s) => s.id !== id),
    );
    await this.storage.write(
      `pending-${user.id}`,
      (await this.storage.read<string[]>(`pending-${user.id}`, [])).filter((x) => x !== id),
    );
  }
}
