# Changelog

## 0.1.1

- Show a live countdown and local retry time from provider rate-limit headers, with clock-skew correction. Missing or invalid timing is explained without an invented reset time.
- Distinguish ordinary access-denied (403), invalid credentials (401), and throttled (403/429) responses.
- Block repeated requests during a known cooldown; stop a scan if manifest reads are throttled or denied instead of returning a successful partial report.
- Add optional per-account GitHub personal access tokens, validated before encrypted local storage, with a remove-token control. Tokens go only to GitHub's API and do not enable private repository scans.
- Cache bounded immutable revision data for ten minutes while refreshing repository visibility, branch revision, and local system checks.
- Preserve structured errors through Electron's isolated renderer boundary.

Validation: 59 backend tests, six browser interface tests, and the production build pass. A real GitHub throttle displayed the reset countdown in the packaged Mac app. Windows packages are cross-built; Windows runtime validation and installer signing remain pending.

## 0.1.0

Initial development preview with public GitHub/GitLab inspection, local compatibility checks, reviewed installation/run plans, Google sign-in, and account history.
