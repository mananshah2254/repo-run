import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { shell } from 'electron';
import type { User } from '../shared/types';
import { Storage } from './storage';

export const CALLBACK = 'http://127.0.0.1:42813/auth/callback';
export class Auth {
  client: SupabaseClient | null = null;
  private signingIn = false;
  constructor(private storage: Storage) {}
  async initialize(defaults: { supabaseUrl: string; supabaseKey: string }) {
    const settings = await this.storage.read('config', {
      url: defaults.supabaseUrl,
      key: defaults.supabaseKey,
    });
    if (settings.url && settings.key) this.create(settings.url, settings.key);
  }
  private create(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: {
        storage: this.storage.authStorage,
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }) },
    });
  }
  async configure(url: string, key: string) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/'
    )
      throw new Error('Enter your Supabase project URL, such as https://your-project.supabase.co.');
    if (key.startsWith('sb_secret_') || key.length < 25)
      throw new Error('Use your publishable or anon key. Never use a secret or service-role key.');
    if (key.startsWith('ey')) {
      try {
        if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role !== 'anon')
          throw new Error();
      } catch {
        throw new Error('Use the public anon key, not a service-role key.');
      }
    }
    await this.client?.auth.signOut({ scope: 'local' });
    await this.storage.write('config', { url: parsed.origin, key });
    this.create(parsed.origin, key);
  }
  async user(): Promise<User | null> {
    if (!this.client) return null;
    const { data } = await this.client.auth.getSession();
    const u = data.session?.user;
    return u
      ? {
          id: u.id,
          email: u.email || '',
          name: u.user_metadata.full_name || u.email?.split('@')[0] || 'Your account',
        }
      : null;
  }
  async requireUser(): Promise<User> {
    const user = await this.user();
    if (!user) throw new Error('Sign in with Google to check repositories and save your history.');
    return user;
  }
  async signIn(): Promise<User> {
    if (!this.client)
      throw new Error('Connect a Supabase project in Settings to enable Google sign-in.');
    if (this.signingIn)
      throw new Error('A sign-in is already in progress. Finish it in your browser.');
    this.signingIn = true;
    const nonce = randomBytes(24).toString('hex');
    const client = this.client;
    try {
      return await new Promise<User>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, user?: User) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          server.close();
          server.closeAllConnections();
          error ? reject(error) : resolve(user!);
        };
        const server = createServer(async (req, res) => {
          const url = new URL(req.url || '/', CALLBACK);
          if (
            req.method !== 'GET' ||
            req.headers.host !== '127.0.0.1:42813' ||
            url.pathname !== '/auth/callback' ||
            url.searchParams.get('nonce') !== nonce
          ) {
            res.writeHead(404);
            res.end();
            return;
          }
          const code = url.searchParams.get('code');
          if (!code) {
            res.writeHead(400);
            res.end('Sign-in was not completed. Return to Repo Run and try again.');
            finish(new Error('Google sign-in was cancelled or denied.'));
            return;
          }
          try {
            const { error } = await client.auth.exchangeCodeForSession(code);
            if (error) throw error;
            const user = await this.requireUser();
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
              'Cache-Control': 'no-store',
            });
            res.end(
              '<!doctype html><html><title>Repo Run</title><body style="font-family:system-ui;background:#f5f6f3;color:#203d32;padding:100px;text-align:center"><h1>You’re all set.</h1><p>Return to Repo Run. You can close this tab.</p></body></html>',
            );
            finish(undefined, user);
          } catch {
            res.writeHead(400);
            res.end('Unable to finish sign-in. Return to Repo Run and try again.');
            finish(
              new Error(
                'Could not complete Google sign-in. Check your provider and redirect URL configuration.',
              ),
            );
          }
        });
        const timeout = setTimeout(
          () => finish(new Error('Sign-in timed out. Please try again.')),
          180000,
        );
        server.on('error', () =>
          finish(
            new Error(
              'The sign-in callback port 42813 is in use. Close the other sign-in attempt and retry.',
            ),
          ),
        );
        server.listen(42813, '127.0.0.1', async () => {
          try {
            const { data, error } = await client.auth.signInWithOAuth({
              provider: 'google',
              options: {
                redirectTo: `${CALLBACK}?nonce=${nonce}`,
                skipBrowserRedirect: true,
                queryParams: { prompt: 'select_account' },
              },
            });
            if (error || !data.url)
              throw new Error(
                'Google sign-in is unavailable. Enable Google in your Supabase project.',
              );
            await shell.openExternal(data.url);
          } catch (error) {
            finish(error as Error);
          }
        });
      });
    } finally {
      this.signingIn = false;
    }
  }
  async signOut() {
    const { error } = (await this.client?.auth.signOut({ scope: 'local' })) || {};
    if (error) throw error;
  }
}
