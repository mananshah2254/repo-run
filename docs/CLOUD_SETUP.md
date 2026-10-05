# Google sign-in and saved history

## Hosted preview status

The hosted development service uses Supabase. Google sign-in, account history synchronization, and session persistence after restart have been verified on Mac. Google authentication remains in Testing; general public sign-in is not yet available. Windows sign-in and cross-device synchronization still need verification.

Builds contain only a public Supabase URL and publishable client key. Google client secrets, database passwords, signing certificates, and user sessions must never be committed or included in installers.

## Configure a project

1. Create a Supabase Free project. Keep the database password in your password manager; the desktop app does not need it.
2. Run `supabase/migrations/202610050001_repository_checks.sql` in the SQL editor. If automatically exposing new tables is disabled, the migration explicitly grants authenticated access to this table; anonymous access remains revoked.
3. In **Authentication → URL Configuration**, allow `http://127.0.0.1:42813/auth/callback**`. The suffix allows the per-login random nonce query parameter. The callback server binds only to `127.0.0.1`, verifies host/path/nonce, and shuts down after completion or timeout.
4. In a Google Cloud project, configure the OAuth consent screen for **Repo Run** with `openid`, email and basic profile access. Add your account as a test user while the app is in testing. Public launch requires the appropriate Google publishing/verification steps and privacy/support pages.
5. Create a **Web application** OAuth client for Supabase. Google redirects to Supabase, which exchanges the desktop's PKCE code; do not use a Google desktop client for this Supabase-hosted flow.
6. Add this Google authorized redirect URI: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. For another Supabase project, replace its project reference.
7. In Supabase **Authentication → Sign In / Providers → Google**, enter the Google client ID and client secret, and enable Google. The secret stays in Supabase, never in this repository or desktop app.
8. Copy your Supabase **publishable** key (or legacy **anon** key). Set `REPO_RUN_SUPABASE_URL` and `REPO_RUN_SUPABASE_ANON_KEY` in `.env`. The build includes these public values in the desktop bundle. Never use a secret or service-role key.
9. Start the desktop app, click Sign in, finish consent in the browser, and verify the account appears. Check a real repository, then verify the check appears in another signed-in installation.

## Verify isolation

`supabase/tests/rls.sql` is a transactional test using two disposable fixture users. It checks that a second account cannot read, overwrite, delete or insert another user's check, then rolls back. Use it in a development database. Anonymous REST access should return permission denied or no data depending on API configuration.

## Free tier

As checked October 5, 2026, Supabase Free includes 50,000 monthly active auth users and 500 MB database space. That is an auth allowance, not a guarantee of zero cost at 50,000 users: history storage and bandwidth may reach their limits sooner. Free projects may pause after low activity for seven days. Repo Run users need no paid subscription; the app owner is responsible for any hosting upgrades.

Sources: https://supabase.com/pricing and https://supabase.com/docs/guides/platform/free-project-pausing
