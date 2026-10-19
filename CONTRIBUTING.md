# Contributing to Repo Run

Thanks for helping make repository setup easier to understand. Bug reports,
documentation corrections, test cases, and code changes are welcome.

## Before you start

- Check existing issues and pull requests for related work. For a larger change,
  open an issue first so the approach can be discussed.
- Do not include access tokens, `.env` values, private repository contents, or
  local file paths in issues, logs, screenshots, or commits.
- Contact the maintainer privately about a suspected security issue instead
  of opening a public issue.

## Local setup

Use Node.js 24 LTS (minimum 22.12) and npm. Follow the [development setup in
the README](README.md#development): run `npm ci`, copy `.env.example` to `.env`,
and add your own public Supabase connection values when working on account
features. The `.env` file stays local.

`npm run dev:web` starts a browser preview with sample data. It cannot inspect
the computer or exercise native Electron features; use `npm run dev` for those.

## Make a change

1. Create a topic branch from `main`.
2. Keep the change focused and explain the user-visible behavior in the pull
   request. Include screenshots for interface changes.
3. Add or update tests for behavior changes. Run `npm test`, `npm run
   typecheck`, and `npm run build`. For browser UI changes, also run `npm run
   test:ui` after installing Playwright Chromium with `npx playwright install
   chromium`.
4. Open a pull request and describe how you verified it, including any checks
   you could not run.

Repo Run handles untrusted repository metadata and can propose local commands.
Changes to manifest parsing, command plans, downloads, authentication, or IPC
should preserve the explicit preview and confirmation boundaries described in
the [README](README.md#installation-behavior).

The project is licensed under [MIT](LICENSE).
