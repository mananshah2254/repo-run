import type { Storage } from './storage';
import { ProviderHttp } from './core/provider-http';

// Separate from Google login. Tokens stay local, scoped to the current Repo Run account.
export class GithubConnection {
  constructor(
    private storage: Pick<Storage, 'authStorage'>,
    private http: ProviderHttp,
  ) {}
  async token(userId: string) {
    return (await this.storage.authStorage.getItem(`github-${userId}`)) || undefined;
  }
  async save(userId: string, token: string) {
    token = token.trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(token))
      throw new Error('Enter a valid GitHub personal access token. Do not enter your password.');
    const user = JSON.parse(await this.http.request('https://api.github.com/user', 64_000, token));
    if (typeof user.login !== 'string' || !user.login)
      throw new Error('GitHub could not validate that token.');
    await this.storage.authStorage.setItem(`github-${userId}`, token);
    this.http.clearCache();
  }
  async remove(userId: string) {
    await this.storage.authStorage.removeItem(`github-${userId}`);
    this.http.clearCache();
  }
}
