import { test, expect } from '@playwright/test';
test('sample report has honest statuses, filters, setup notes, and no simulated installs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Great projects start/ })).toBeVisible();
  await page.getByRole('button', { name: 'Explore a sample check' }).click();
  await expect(
    page.getByText('This sample uses example repository and system data.'),
  ).toBeVisible();
  await expect(page.getByText('Version mismatch', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Needs attention' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect(page.getByRole('status')).toContainText('example');
  await page.getByRole('tab', { name: 'Setup notes' }).click();
  await expect(page.getByText(/Set DATABASE_URL/)).toBeVisible();
  await page.getByRole('tab', { name: 'Projects & run' }).click();
  await expect(page.getByRole('heading', { name: 'studio-web' })).toBeVisible();
});
test('browser preview never pretends to inspect the host computer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Repository URL').fill('https://github.com/vitejs/vite');
  await page.getByRole('button', { name: 'Check repository', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('desktop app');
  await page.getByRole('button', { name: 'My computer' }).click();
  await expect(page.getByText('This browser can’t inspect your computer.')).toBeVisible();
});
test('auth dialog is keyboard accessible and setup is explicit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up Google sign-in' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Supabase project URL')).toBeVisible();
});
test('home and sample report stay within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Explore a sample check' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('provider reset time counts down and remains actionable after expiry', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.addInitScript(() => {
    window.repoRun = {
      getState: async () => ({
        desktop: true,
        configured: true,
        user: { id: 'test', name: 'Tester', email: 'test@example.com' },
        machine: null,
        version: 'test',
      }),
      system: async () => ({
        platform: 'darwin',
        label: 'macOS',
        arch: 'arm64',
        release: '',
        tools: [],
        checkedAt: '',
      }),
      history: async () => ({ scans: [] }),
      onLog: () => () => {},
      scan: async () => {
        throw new Error(
          'REPO_RUN_ERROR:' +
            JSON.stringify({
              code: 'rate-limit',
              provider: 'GitHub',
              message: 'GitHub API limit reached.',
              retryAt: Date.now() + 120000,
            }),
        );
      },
    } as unknown as NonNullable<typeof window.repoRun>;
  });
  await page.goto('/');
  await page.getByLabel('Repository URL').fill('https://github.com/example/repository');
  await page.getByRole('button', { name: 'Check repository', exact: true }).click();
  await expect(page.getByRole('timer')).toContainText('2m 0s');
  await expect(page.getByRole('timer')).toContainText('Retry time:');
  await page.clock.fastForward(61000);
  await expect(page.getByRole('timer')).toContainText('59s');
  await page.clock.fastForward(60000);
  await expect(page.getByRole('timer')).toContainText('wait time has elapsed');
  await page.getByRole('button', { name: 'GitHub connection settings' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub connection', exact: true })).toBeVisible();
});

test('optional GitHub token is cleared after saving and can be removed', async ({ page }) => {
  await page.addInitScript(() => {
    let connected = false;
    window.repoRun = {
      getState: async () => ({
        desktop: true,
        configured: true,
        user: { id: 'test', name: 'Tester', email: 'test@example.com' },
        machine: null,
        version: 'test',
        githubConnected: connected,
      }),
      system: async () => ({
        platform: 'darwin',
        label: 'macOS',
        arch: 'arm64',
        release: '',
        tools: [],
        checkedAt: '',
      }),
      history: async () => ({ scans: [] }),
      onLog: () => () => {},
      setGithubToken: async () => {
        connected = true;
      },
      removeGithubToken: async () => {
        connected = false;
      },
    } as unknown as NonNullable<typeof window.repoRun>;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('test_fixture_token_not_real');
  await page.getByRole('button', { name: 'Save GitHub token', exact: true }).click();
  await expect(page.getByLabel('GitHub personal access token')).toHaveValue('');
  await expect(page.getByText('Token saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove GitHub token', exact: true }).click();
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove GitHub token', exact: true })).toHaveCount(
    0,
  );
});
