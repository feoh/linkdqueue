import { expect, test, type Page } from '@playwright/test';

async function commands(page: Page): Promise<Array<{ command: string; input: unknown }>> {
  return page.evaluate(() => window.__linkdqueueE2E?.commands ?? []);
}

async function connect(page: Page): Promise<void> {
  await page.goto('/e2e.html');
  await expect(page.getByRole('heading', { name: 'Connect to Linkding' })).toBeVisible();
  await page.getByLabel('Linkding URL').fill('https://fixture.linkding.test');
  await page.getByLabel('New API token').fill('fake-e2e-token');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status')).toContainText('Connection successful.');
  await page.getByLabel('New API token').fill('fake-e2e-token');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
  await expect(page.locator('[data-bookmark-id="1"]')).toBeVisible();
}

test.describe('browser evidence: onboarding, navigation, paging, and filters', () => {
  test('onboards with fake credentials, searches, pages after retry, and opens All tagged', async ({
    page,
  }) => {
    await connect(page);

    await page.getByLabel('Search bookmarks').fill('Queue bookmark 21');
    await expect(page.getByRole('heading', { name: 'Queue bookmark 21' })).toBeVisible();
    await expect(page.locator('[data-bookmark-id="21"]')).toBeVisible();

    await page.getByLabel('Search bookmarks').fill('');
    await expect(page.locator('[data-bookmark-id="1"]')).toBeVisible();
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tag catalogue' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all bookmarks tagged python' }).click();
    await expect(
      page.getByRole('heading', { name: 'All bookmarks tagged “python”' }),
    ).toBeVisible();
    await expect(page.locator('[data-bookmark-id="1"]')).toBeVisible();

    await page.getByRole('button', { name: 'Queue' }).first().click();
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('button', { name: 'Retry loading' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Queue bookmark 1', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retry loading' }).click();
    await expect(page.getByRole('heading', { name: 'Queue bookmark 21' })).toBeVisible();

    const seen = await commands(page);
    expect(
      seen.some(
        ({ command, input }) => command === 'test_connection' && input && typeof input === 'object',
      ),
    ).toBeTruthy();
    expect(
      seen.some(
        ({ command, input }) => command === 'save_connection' && input && typeof input === 'object',
      ),
    ).toBeTruthy();
    expect(
      seen.filter(
        ({ command, input }) =>
          command === 'list_bookmarks' &&
          input &&
          typeof input === 'object' &&
          'offset' in input &&
          input.offset === 20 &&
          input.scope === 'queue',
      ),
    ).toHaveLength(2);
    expect(
      seen.some(
        ({ command, input }) =>
          command === 'list_bookmarks' &&
          input &&
          typeof input === 'object' &&
          input.tag === 'python',
      ),
    ).toBeTruthy();
  });
});

test.describe('browser evidence: bookmark actions and recovery', () => {
  test('opens with a visible error/retry, adds as read, and mutates queue/archive', async ({
    page,
  }) => {
    await connect(page);
    const first = page.locator('[data-bookmark-id="1"]');
    await first.getByRole('button', { name: 'Open bookmark' }).click();
    await expect(first.getByRole('alert')).toContainText('could not be opened');
    await first.getByRole('button', { name: 'Open bookmark' }).click();
    await first.getByRole('button', { name: 'Mark as read' }).click();
    await expect(first).not.toBeVisible();

    await page.getByRole('button', { name: 'New bookmark' }).click();
    await expect(page.getByRole('dialog', { name: 'Add bookmark' })).toBeVisible();
    await page.getByLabel('URL *').fill('https://example.test/read-later');
    await page.getByLabel('Title').fill('Read later fixture');
    await page.getByLabel('Mark as read').check();
    await page.getByRole('button', { name: 'Save bookmark' }).click();
    await expect(page.getByRole('dialog', { name: 'Add bookmark' })).not.toBeVisible();

    const second = page.locator('[data-bookmark-id="2"]');
    await second.getByRole('button', { name: 'Archive' }).click();
    await expect(second).not.toBeVisible();
    await page.getByRole('button', { name: 'Archive' }).first().click();
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
    await expect(page.locator('[data-bookmark-id="26"]')).toBeVisible();
    await page
      .locator('[data-bookmark-id="26"]')
      .getByRole('button', { name: 'Unarchive' })
      .click();
    await expect(page.locator('[data-bookmark-id="26"]')).not.toBeVisible();

    const deletable = page.locator('[data-bookmark-id="27"]');
    await deletable.getByRole('button', { name: 'Delete bookmark' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete bookmark' });
    await expect(dialog).toBeVisible();
    const beforeCancel = (await commands(page)).filter(
      ({ command }) => command === 'delete_bookmark',
    ).length;
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (await commands(page)).filter(({ command }) => command === 'delete_bookmark').length,
    ).toBe(beforeCancel);
    await deletable.getByRole('button', { name: 'Delete bookmark' }).click();
    await page
      .getByRole('dialog', { name: 'Delete bookmark' })
      .getByRole('button', { name: 'Confirm delete bookmark' })
      .click();
    await expect(deletable).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bookmarks', exact: true })).toBeFocused();

    const seen = await commands(page);
    expect(seen.filter(({ command }) => command === 'open_external_url')).toHaveLength(2);
    expect(
      seen.some(
        ({ command, input }) =>
          command === 'create_bookmark' &&
          input &&
          typeof input === 'object' &&
          input.isRead === true,
      ),
    ).toBeTruthy();
    expect(seen.some(({ command }) => command === 'mark_read')).toBeTruthy();
    expect(seen.some(({ command }) => command === 'archive_bookmark')).toBeTruthy();
    expect(seen.some(({ command }) => command === 'unarchive_bookmark')).toBeTruthy();
    expect(seen.some(({ command }) => command === 'delete_bookmark')).toBeTruthy();
  });

  test('keeps failed tag replacement draft visible, then saves the cleared tags', async ({
    page,
  }) => {
    await connect(page);
    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await page.getByRole('button', { name: 'Show all bookmarks tagged python' }).click();
    const row = page.locator('[data-bookmark-id="1"]');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Edit tags' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit tags' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear all tags' }).click();
    await dialog.getByRole('button', { name: 'Save tags' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('server failed the request');
    await expect(dialog.getByRole('status')).toContainText('Tags were not saved');
    await dialog.getByRole('button', { name: 'Save tags' }).click();
    await expect
      .poll(
        async () =>
          (await commands(page)).filter(({ command }) => command === 'replace_bookmark_tags')
            .length,
      )
      .toBe(2);
    await expect(dialog).not.toBeVisible();

    const saves = (await commands(page)).filter(
      ({ command }) => command === 'replace_bookmark_tags',
    );
    expect(saves).toHaveLength(2);
    expect((saves[0].input as { tagNames: string[] }).tagNames).toEqual([]);
    expect((saves[1].input as { tagNames: string[] }).tagNames).toEqual([]);
  });
});

test.describe('browser evidence: settings, theme, and disconnect', () => {
  test('persists display settings and confirms clear while cancel remains side-effect free', async ({
    page,
  }) => {
    await connect(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Display' })).toBeVisible();
    await page.getByLabel('Color theme').selectOption('dracula');
    await page.getByRole('button', { name: 'Save display preferences' }).click();
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dracula');
    const display = (await commands(page)).find(
      ({ command }) => command === 'set_display_preferences',
    );
    expect(display?.input).toMatchObject({ theme: 'dracula' });

    const beforeCancel = (await commands(page)).filter(
      ({ command }) => command === 'clear_connection',
    ).length;
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Clear connection' }).click();
    expect(
      (await commands(page)).filter(({ command }) => command === 'clear_connection').length,
    ).toBe(beforeCancel);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Clear connection' }).click();
    await expect(page.getByRole('heading', { name: 'Connect to Linkding' })).toBeVisible();
    expect(
      (await commands(page)).some(({ command }) => command === 'clear_connection'),
    ).toBeTruthy();
  });
});
