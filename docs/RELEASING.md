# Build and distribute Repo Run

Use Node 24 and the committed npm lockfile. `npm run build` typechecks and bundles all application code. `.env` or build environment variables set the Supabase public client configuration.

## Local preview

```sh
npm ci
npm test
npm run build
npm start
```

For an unsigned/ad-hoc macOS development package without accessing an Apple certificate:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir -c.mac.identity=null -c.mac.notarize=false --publish never
```

Unsigned development builds are not a substitute for a signed, notarized public release. Do not instruct users to disable Gatekeeper.

## Mac release

Use a **Developer ID Application** identity for direct download distribution. Repo Run's chosen release process keeps Mac signing on the maintainer's Mac, using its installed identity and the `repo-run-notary` Keychain profile. Do not export or upload the Mac private key or notarization credentials to GitHub for this process. Apple Distribution / Mac App Store certificates serve a different distribution channel.

If the maintainer later chooses to move Mac signing to GitHub Actions, export the identity and private key as a password-protected `.p12` outside the repository and configure the following secrets for the `Build signed installers` workflow:

- `MAC_CSC_LINK`: base64-encoded signing certificate or supported secure certificate location.
- `MAC_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: developer account used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple developer team identifier.

Set repository variables `REPO_RUN_SUPABASE_URL` and `REPO_RUN_SUPABASE_ANON_KEY` to public client values. The workflow produces Intel and Apple silicon DMGs and ZIPs with hardened runtime and notarization enabled. It uploads build artifacts, not a public release.

The release workflow fails if signing or notarization credentials are missing. It verifies app signatures and stapled notarization tickets, submits the signed DMGs to Apple, staples their tickets, and checks Gatekeeper acceptance before uploading artifacts. Do not paste certificate passwords, Google client secrets or database passwords into chat or tracked files.

For local releases, an installed Developer ID Application identity can be used without exporting the private key. Store notarization credentials in Keychain using `xcrun notarytool store-credentials repo-run-notary` in an interactive Terminal. Enter the Apple developer account, team ID and app-specific password when prompted; do not put passwords in shell history. Then set `APPLE_KEYCHAIN_PROFILE=repo-run-notary` when running electron-builder. Use `-c.mac.forceCodeSigning=true -c.dmg.sign=true` for release builds. Submit and staple each DMG separately, then run the same signature, ticket and Gatekeeper checks as the workflow before publishing it.

## Windows release

Use the Windows workflow runner for native validation and NSIS installer generation. The app builds x64 and ARM64 installers with per-user installation and a directory chooser.

Provide `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` if using an exportable Windows certificate. If using hardware-backed or cloud signing, configure electron-builder's supported signing integration instead. Apple certificates do not sign Windows applications. Unsigned Windows installers may display SmartScreen warnings.

The signed installer workflow requires `WIN_CSC_LINK`, forces code signing, and checks trusted Authenticode signatures and timestamps on both installers and both packaged app executables before uploading artifacts. A missing certificate fails the job instead of producing an unsigned release. The password secret may be empty for a certificate that does not require one. A cloud or hardware signing integration must replace the certificate preflight as well as configure its signing backend.

Choose `mac`, `windows`, or `both` when dispatching the workflow. Mac signing can also stay local using the Keychain procedure above; GitHub secrets are only needed for signing on GitHub runners. Automated build checks do not replace interactive installation and Google login checks on real supported systems.

## Release checklist

- Verify Google OAuth consent, callback and session refresh on both operating systems.
- Verify one account's history syncs between two devices, and two accounts cannot access each other's history.
- Inspect representative Node, Python, Rust and Go projects with compatible, missing and incompatible runtimes.
- Verify Homebrew/winget installation and PATH refresh on clean machines. Check exact constraints after installation.
- Review setup commands, download pinned revisions, and confirm startup/log streaming/process cancellation.
- Verify behavior without Git, without the OS package manager, while offline, under API rate limiting, and after provider errors.
- Verify screen reader navigation, keyboard focus, contrast and Windows scaling.
- Validate Apple signature/notarization with `codesign` and `spctl`, and Windows signature with the Windows signing tools.
- Add a support contact, privacy policy, public distribution location and a release/update policy before a public launch.

There is no auto-updater in this initial version. Plan to publish updated installers regularly to keep Electron's security patches current.

## GitHub repositories

- Source and build workflows: https://github.com/mananshah2254/repo-run
- Installer releases and download instructions: https://github.com/mananshah2254/repo-run-downloads

Publish binaries as assets of a versioned release in the downloads repository. Keep binaries out of Git history. Include SHA-256 checksums and the corresponding source commit in the release notes. Mark unsigned or incompletely verified builds as prereleases and describe authentication availability explicitly. The signed build workflow produces artifacts for review; it does not publish automatically.
