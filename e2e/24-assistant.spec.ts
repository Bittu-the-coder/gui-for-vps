import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { api, gotoPath, openApp, openGfv, vpsUp } from './helpers';

// M23 in the browser. The "model" is a fake OpenAI-compatible server in this process, so the whole flow is real
// (settings, preview, scrubbing, the single outbound request, proposals) without needing an API key.
let model: Server;
const requests: { messages: { role: string; content: string }[] }[] = [];
let url = '';

test.beforeAll(async () => {
  model = createServer((req, res) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => {
      requests.push(JSON.parse(data));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: 'Port 8080 is closed by the firewall. You can allow it.',
                  actions: [
                    {
                      actionId: 'firewall.allow',
                      params: { policy: 'allow', port: '8080' },
                      why: 'lets your app be reached',
                    },
                    { actionId: 'not.a.real.action', params: {}, why: 'invented' },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
});
test.afterAll(async () => {
  await new Promise((r) => model.close(r));
});

async function turnOn(page: Page) {
  await openApp(page, 'assistant');
  await expect(page.getByTestId('ai-settings')).toBeVisible();
  await page.getByLabel('Provider').selectOption('openai-compatible');
  await page.getByLabel('Server address').fill(url);
  await page.getByLabel('Turn the assistant on').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('ai-destination')).toContainText('stays on this computer');
}

test('Assistant: nothing is sent until you preview and press Send; proposals need your review', async ({
  page,
}) => {
  test.setTimeout(120_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  requests.length = 0;
  await openGfv(page);
  await api(page, 'PUT', '/api/ai/settings', {
    enabled: false,
    provider: 'anthropic',
    model: 'x',
    baseUrl: '',
  });
  await page.reload();
  await turnOn(page);

  await page
    .getByLabel('Your message')
    .fill('why can I not reach port 8080? my DB_PASSWORD=hunter2-secret is set');
  await page.getByRole('button', { name: 'Preview what will be sent' }).click();
  const preview = page.getByTestId('ai-preview');
  await expect(preview).toContainText('stays on your computer');
  await expect(page.getByTestId('ai-scrubbed')).toBeVisible();
  await expect(page.getByTestId('ai-payload')).not.toContainText('hunter2');
  await expect(page.getByTestId('ai-payload')).toContainText('port 8080');
  expect(requests).toHaveLength(0); // previewing sent NOTHING

  // Cancel really cancels.
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toBeHidden();
  expect(requests).toHaveLength(0);

  await page.getByRole('button', { name: 'Preview what will be sent' }).click();
  const shown = await page.getByTestId('ai-payload').innerText();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('ai-answer')).toContainText('closed by the firewall', {
    timeout: 30_000,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.messages[1]!.content.trim()).toBe(shown.trim()); // what was shown is what was sent
  expect(JSON.stringify(requests[0])).not.toContain('hunter2');

  // The real action is offered, the invented one is dropped, and running needs the normal review.
  await expect(page.getByTestId('ai-proposal')).toHaveCount(1);
  await expect(page.getByTestId('ai-proposal')).toContainText('Add a firewall rule');
  await expect(page.getByTestId('ai-proposal')).toContainText('caution');
  await expect(page.getByText('1 suggestion(s) were dropped')).toBeVisible();
  await page.getByRole('button', { name: 'Review and run…' }).click();
  await expect(page.getByText('What this does')).toBeVisible();
  await expect(page.getByText('ufw allow from any to any port 8080').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click(); // never run in this test
});

test('Assistant: a failed run offers to explain the error, and prefills the text for review', async ({
  page,
}) => {
  test.setTimeout(120_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await api(page, 'PUT', '/api/ai/settings', {
    enabled: true,
    provider: 'openai-compatible',
    model: 'm',
    baseUrl: url,
  });
  await page.reload();
  // Creating a folder in / is refused for the SSH user: a real failed run.
  await openApp(page, 'files');
  await gotoPath(page, '/');
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Name').fill('gfv-not-allowed');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText('What this does').waitFor();
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByTestId('run-result')).toContainText('Failed', { timeout: 30_000 });
  await page.getByTestId('explain-with-ai').click();
  await expect(page.getByLabel('Your message')).toHaveValue(/This command failed/);
  await page.getByRole('button', { name: 'Preview what will be sent' }).click();
  await expect(page.getByTestId('ai-preview')).toContainText(/Permission denied/i);
});

for (const theme of ['light', 'dark'] as const) {
  test(`Assistant contrast with a preview and an answer (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
    await prepare(page, theme);
    await api(page, 'PUT', '/api/ai/settings', {
      enabled: true,
      provider: 'openai-compatible',
      model: 'm',
      baseUrl: url,
    });
    await page.reload();
    await openApp(page, 'assistant');
    await page.getByLabel('Your message').fill('open port 8080 with token=abc123def456');
    await page.getByRole('button', { name: 'Preview what will be sent' }).click();
    await expect(page.getByTestId('ai-preview')).toBeVisible();
    await settle(page);
    const failures = (await auditContrast(page)).map((f) => `[${theme}] assistant preview: ${f}`);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('ai-proposal')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    if (process.env.SHOT_DIR)
      await page.screenshot({ path: `${process.env.SHOT_DIR}/assistant-${theme}.png` });
    failures.push(...(await auditContrast(page)).map((f) => `[${theme}] assistant answer: ${f}`));
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
