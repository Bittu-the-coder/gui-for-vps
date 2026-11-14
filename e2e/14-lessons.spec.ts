import { expect, test } from '@playwright/test';
import { confirmRun, openApp, openGfv, vpsUp } from './helpers';

// M16: a guided lesson that uses the real server, quizzes, and skill levels.
test.beforeEach(async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await page.evaluate(() => {
    localStorage.removeItem('gfv.lessons.v1');
    localStorage.removeItem('gfv.skill.v1');
    localStorage.removeItem('gfv.learn.v1');
  });
  await page.reload();
});

test('work through a lesson: read, run a real command, answer quizzes (a wrong answer first)', async ({
  page,
}) => {
  await openApp(page, 'lessons');
  await page.getByTestId('lesson-card').filter({ hasText: 'Your first command' }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // the intro

  // "Do it" step: completes when the command really ran on the server.
  await expect(page.getByText('Waiting for you to do it…')).toBeVisible();
  await page.getByRole('button', { name: 'Run it for me' }).click();
  await confirmRun(page);
  await expect(page.getByRole('status').filter({ hasText: 'You did it.' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Continue' }).click();

  // Quiz: wrong first, then right.
  const quiz = page.getByRole('radiogroup', { name: /Which command prints how long/ });
  await quiz.getByRole('radio', { name: 'whoami' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Not quite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await quiz.getByRole('radio', { name: 'uptime', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Correct.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('radio', { name: /almost idle/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('lesson-complete')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Lesson progress' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );

  // Progress is remembered: back in the list the lesson is marked done, and survives a reload.
  await page.getByRole('button', { name: 'Back to lessons' }).click();
  await expect(
    page
      .getByTestId('lesson-card')
      .filter({ hasText: 'Your first command' })
      .getByLabel('Completed'),
  ).toBeVisible();
  await page.reload();
  await openApp(page, 'lessons');
  await expect(
    page
      .getByTestId('lesson-card')
      .filter({ hasText: 'Your first command' })
      .getByLabel('Completed'),
  ).toBeVisible();
});

test('the skill level only changes what is shown by default, never the safety confirmation', async ({
  page,
}) => {
  await openApp(page, 'lessons');
  await expect(page.getByRole('complementary', { name: 'Learn Mode' })).toBeVisible(); // beginner: panel open
  await page.getByRole('radio', { name: 'Expert' }).click();
  await expect(page.getByRole('complementary', { name: 'Learn Mode' })).toBeHidden(); // expert: panel closed

  // Run a risky action: the explanation is folded away, but the risk checkbox is still required.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('clear the package');
  await page.getByRole('option').filter({ hasText: 'Run:' }).first().click();
  const explain = page.locator('details').filter({ hasText: 'What this does' });
  await expect(explain).toBeVisible();
  await expect(explain).not.toHaveAttribute('open', '');
  await expect(page.getByLabel('I understand the risk')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run anyway' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('radio', { name: 'Beginner' }).click();
  await expect(page.getByRole('complementary', { name: 'Learn Mode' })).toBeVisible();
});
