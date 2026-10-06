# Repo Run

A free, MIT-licensed desktop app for macOS and Windows that helps people understand what a public repository needs before they run it.

Repo Run reads repository manifests, compares runtime requirements with the current computer, explains missing tools and version conflicts, and offers explicit command previews before installing, downloading, or running anything. Google sign-in links the latest 100 checks to a user's account through Supabase.

## Downloads

Get the [Mac and Windows preview installers](https://github.com/mananshah2254/repo-run-downloads/releases/tag/v0.1.1) from the separate [downloads repository](https://github.com/mananshah2254/repo-run-downloads).

The current preview provides **Mac Apple silicon (ARM64)** and **Windows x64** installers. They are unsigned; the Mac build is not notarized. Google sign-in is still in testing, so general public account access is not yet available. Mac sign-in and synced history have been verified; Windows runtime testing remains pending. Read the release notes before downloading.

## Development

Use **Node.js 24 LTS** (minimum 22.12) and npm. This Node version is for building Repo Run; packaged desktop users do not need Node installed to open the app.

```sh
npm ci
cp .env.example .env
# Fill the public Supabase URL and publishable/anon key in .env.
npm run dev
```

`npm run dev:web` opens a browser preview with a clearly labeled example report. Browser previews cannot inspect your computer, sign in, install tools, or run projects. Use `npm run dev` or `npm run build && npm start` for the actual desktop app.

```sh
npm test            # Engine, parser, version and command-plan regression tests
npm run test:ui     # Install browsers first: npx playwright install chromium
npm run build      # Typecheck and bundle renderer, main process and preload
npm run pack       # Unpacked desktop application
npm run dist:mac    # Mac DMG and ZIP, Apple silicon and Intel
npm run dist:win    # Windows NSIS installers, x64 and ARM64; use Windows CI
```

## Account service

See [cloud setup](docs/CLOUD_SETUP.md). End users only see Google sign-in. The developer sets the Supabase public connection values at build time; a Settings form is provided for development or independently hosted distributions.

- Google OAuth uses the system browser and PKCE with a nonce-validated loopback callback.
- Auth tokens are stored using Electron's OS-backed `safeStorage`, never in renderer localStorage.
- The database enforces row-level security for each account.
- History includes repository metadata, manifest requirements, relevant detected versions, OS name and architecture. Full tool inventories, local paths, environment values and logs are not uploaded.
- The latest 100 checks are retained per account. New checks beyond this limit remove the oldest checks. Local cached checks are retried when cloud sync is available.
- Sign-out clears the active session and stops managed jobs; per-account local cached history remains in the app data directory.

## Supported inspection

Public **github.com** and **gitlab.com** repositories, on the current default branch, pinned to an immutable commit. Checks use public API access by default. Settings offers an optional GitHub personal access token to use your authenticated allowance; GitLab requests remain unauthenticated. Private repositories remain unsupported even with a token.

| Ecosystem               | Sources                                                                             | Automated preparation / launch                                 |
| ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| JavaScript / TypeScript | package.json, engines, packageManager, Volta, .nvmrc, .node-version, lockfile names | npm, pnpm, Yarn, Bun package installation and declared scripts |
| Python                  | pyproject.toml, requirements.txt, .python-version, Pipfile presence                 | uv, Poetry, isolated .venv + pip; README-guided launch         |
| Rust                    | Cargo.toml, rust-toolchain.toml                                                     | cargo fetch / cargo run                                        |
| Go                      | go.mod                                                                              | go mod download / go run .                                     |
| Java                    | pom.xml, build.gradle(.kts) presence                                                | Maven dependencies / Gradle build; README-guided launch        |
| Ruby                    | Gemfile, .ruby-version                                                              | bundle install; README-guided launch                           |
| PHP                     | composer.json                                                                       | composer install; README-guided launch                         |
| .NET                    | global.json, .csproj                                                                | dotnet restore / dotnet run                                    |
| Containers              | Dockerfile, Compose service names                                                   | Docker CLI and daemon check; container launch remains manual   |
| Environment             | .tool-versions, .env.example, .env.sample                                           | Variable names only; never values                              |

Node semver ranges and basic Python compatible-release/comparison ranges are supported. Unsupported syntax, aliases, unreadable versions and conflicts are reported for review. This is a deterministic manifest inspector, **not a guarantee that every open-source repository will run**.

Inspection has explicit bounds: 35 relevant files, depth 5, 150 KB per manifest. GitLab examines up to 500 tree entries; GitHub can return a truncated tree. Notices disclose partial reads and parse failures. Generated, vendored and test-fixture manifests are excluded.

## API limits and GitHub connection

Rate-limit errors show a live countdown and local retry time when the provider supplies `Retry-After` or an exhausted quota's reset header. If no valid time is supplied, the app says so instead of guessing. Ordinary 403 permission errors and 401 credential errors have separate explanations. Known cooldowns are enforced locally without automatic retries. Rate or access failures while reading manifests stop the scan; they cannot produce a successful partial report.

Only immutable revision data is cached, for up to ten minutes and 20 MB. Repository visibility and the default branch revision are fetched on every check; local tool versions are also refreshed. Cache and cooldown keys separate providers and GitHub credentials.

For a higher GitHub allowance, sign into Repo Run and open **Settings → GitHub connection**. Supply a fine-grained token restricted to public-repository read access; no write permissions are needed. The token is validated against GitHub before being saved with OS-backed encryption for the current Repo Run account. It is sent only to `api.github.com`, never to GitLab or Supabase, and never passed to Git commands. Remove the token in Settings or revoke it on GitHub. A token does not guarantee unlimited requests or enable private-repository inspection.

Provider timing behavior follows [GitHub's rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [GitLab's rate-limit headers](https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/).

## Installation behavior

- macOS uses an existing Homebrew installation; Windows uses an existing winget installation.
- Supported JavaScript package-manager versions can be installed through npm with lifecycle scripts disabled.
- Runtime installers use a curated catalog. Homebrew versioned formulae are selected where possible. winget package IDs may only offer a current major; installation is followed by an explicit recheck. Installing an available package does not mean a requested exact runtime constraint has been satisfied.
- PATH precedence can keep an older runtime active. Modern Yarn/Corepack, unsupported version switches, package-manager bootstrap, administrator prompts and unavailable versions require manual action using official installation guidance.
- Plans are generated in the main process, tied to the signed-in user, expire in five minutes and can only be executed once. The renderer cannot submit arbitrary commands or directories.
- Repository downloads use HTTPS Git, disable inherited Git hooks/config, and check out the inspected revision. Git LFS and submodules are not fetched automatically.
- Running/installing project dependencies executes third-party code after confirmation. It is **not sandboxed**. Repo Run's own renderer is sandboxed and isolated.
- Jobs stream output, can be stopped, and are stopped on window closure/sign-out. Setup jobs have a 20-minute timeout. Interactive terminal input is not currently supported.
- Managed download locations are remembered locally. After restarting, recheck the repository and use Download to reconnect an existing checkout at the same revision. Local edits are preserved. Checks loaded from history must be rechecked locally before installing or running.

## Distribution and release

[Release instructions](docs/RELEASING.md) cover Apple certificates, notarization and Windows signing. CI workflows test both operating systems and create installable artifacts. No installer is published automatically.

The project is an initial working implementation, not yet a broadly tested public release. Local automated tests cover the core and browser interface; Mac Google sign-in and account history have been verified. Real Windows installation, cross-device history, signed installers and notarization still need verification before a stable release.

## Code layout

- `electron/core/`: repository fetching, manifest analysis, version compatibility, system detection and command plans.
- `electron/main.ts`, `preload.ts`: narrow validated IPC boundary and native desktop integration.
- `electron/auth.ts`, `history.ts`, `storage.ts`: OAuth, account history and encrypted session storage.
- `electron/jobs.ts`: process output, cancellation and completion handling.
- `src/`: React workspace, reports, history, system inventory, settings and sample preview.
- `supabase/`: database migration and transactional row-level security test.
- `tests/`: engine and UI regression tests.

Architecture follows [Electron's isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [Supabase's PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), and [electron-builder signing guidance](https://www.electron.build/code-signing.html).
