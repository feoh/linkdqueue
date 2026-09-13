import { expect, test, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

type E2eCommand = { command: string; input: unknown };

test.setTimeout(90_000);

const THEMES = [
  'system',
  'catppuccinMocha',
  'catppuccinLatte',
  'dracula',
  'tokyoNight',
  'tokyoDay',
  'gruvbox',
  'oneDark',
] as const;

async function commands(page: Page): Promise<E2eCommand[]> {
  return page.evaluate(() => window.__linkdqueueE2E?.commands ?? []);
}

async function browserMetrics(page: Page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    };
    return {
      navigationDurationMs: navigation?.duration ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      domElements: document.getElementsByTagName('*').length,
      usedJSHeapBytes: memory.memory?.usedJSHeapSize ?? null,
      totalJSHeapBytes: memory.memory?.totalJSHeapSize ?? null,
    };
  });
}

async function configureConnection(page: Page): Promise<void> {
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

async function connect(page: Page, dataset = ''): Promise<void> {
  await page.goto(`/e2e.html${dataset ? `?dataset=${dataset}` : ''}`);
  await configureConnection(page);
}

async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `${label}: axe violations`).toEqual([]);
  const viewport = page.viewportSize();
  if (viewport) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${label}: horizontal document overflow`).toBeLessThanOrEqual(
      viewport.width,
    );
  }
}

async function queue(page: Page): Promise<void> {
  await page.locator('aside').getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
  await expect(page.getByLabel('Search bookmarks')).toBeVisible();
}

async function inspectViewsAndModals(page: Page, label: string): Promise<void> {
  await queue(page);
  await expectAccessible(page, `${label} queue`);

  await page.locator('aside').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
  await expectAccessible(page, `${label} archive`);

  await page.locator('aside').getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tag catalogue' })).toBeVisible();
  await expectAccessible(page, `${label} tags`);
  await page.getByRole('button', { name: 'Show all bookmarks tagged python' }).click();
  await expect(page.getByRole('heading', { name: /All bookmarks tagged/ })).toBeVisible();
  await expectAccessible(page, `${label} all tagged`);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Display' })).toBeVisible();
  await expect(page.getByLabel('Color theme')).toBeVisible();
  await expect(page.getByLabel('Text size')).toBeVisible();
  await expectAccessible(page, `${label} settings`);

  await queue(page);
  const newBookmark = page.getByRole('button', { name: 'New bookmark' });
  await newBookmark.focus();
  await page.keyboard.press('Enter');
  const addDialog = page.getByRole('dialog', { name: 'Add bookmark' });
  await expect(addDialog).toBeVisible();
  await expect(addDialog.getByLabel('URL *')).toBeFocused();
  await expectAccessible(page, `${label} add bookmark modal`);
  await page.keyboard.press('Escape');
  await expect(addDialog).not.toBeVisible();
  await expect(newBookmark).toBeFocused();

  const row = page.locator('[data-bookmark-id="1"]');
  const editTags = row.getByRole('button', { name: 'Edit tags' });
  await editTags.click();
  const editDialog = page.getByRole('dialog', { name: 'Edit tags' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole('combobox', { name: 'Tags' })).toBeVisible();
  await expectAccessible(page, `${label} edit tags modal`);
  await page.keyboard.press('Escape');
  await expect(editDialog).not.toBeVisible();
  await expect(editTags).toBeFocused();

  const deleteButton = row.getByRole('button', { name: 'Delete bookmark' });
  await deleteButton.click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete bookmark' });
  await expect(deleteDialog).toBeVisible();
  await expectAccessible(page, `${label} delete bookmark modal`);
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteDialog).not.toBeVisible();
  await expect(deleteButton).toBeFocused();
}

test.describe('browser accessibility evidence', () => {
  test('all named palettes have accessible queue and action contrast states', async ({ page }) => {
    await connect(page);
    for (const theme of THEMES) {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByLabel('Color theme').selectOption(theme);
      await page.getByRole('button', { name: 'Save display preferences' }).click();
      await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(theme);
      await queue(page);
      await expectAccessible(page, `${theme} palette`);
    }

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Color theme').selectOption('system');
    await page.getByRole('button', { name: 'Save display preferences' }).click();
    await queue(page);
    await expectAccessible(page, 'system dark palette');
  });

  for (const theme of ['catppuccinLatte', 'catppuccinMocha']) {
    for (const textScale of ['1', '2']) {
      test(`${theme} at ${textScale === '2' ? '200%' : 'baseline'} has accessible views and modals`, async ({
        page,
      }) => {
        await page.goto('/e2e.html');
        await page.locator('html').evaluate(
          (root, display) => {
            root.dataset.theme = display.theme;
            root.style.setProperty('--text-scale', display.textScale);
          },
          { theme, textScale },
        );
        await expect(page.getByRole('heading', { name: 'Connect to Linkding' })).toBeVisible();
        await expectAccessible(page, `${theme} ${textScale} onboarding`);
        await configureConnection(page);
        await page.getByRole('button', { name: 'Settings' }).click();
        await page.getByLabel('Color theme').selectOption(theme);
        await page.getByLabel('Text size').selectOption(textScale);
        await page.getByRole('button', { name: 'Save display preferences' }).click();
        await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(theme);
        await expect
          .poll(() =>
            page.locator('html').evaluate((root) => root.style.getPropertyValue('--text-scale')),
          )
          .toBe(textScale);
        await inspectViewsAndModals(page, `${theme} ${textScale}`);
      });
    }
  }

  test('honours reduced motion and keeps keyboard focus through modal close and delete', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await connect(page);
    await expect(page.locator('html')).toHaveCSS('--motion-duration', '0ms');
    await queue(page);

    const newBookmark = page.getByRole('button', { name: 'New bookmark' });
    await newBookmark.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Add bookmark' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(newBookmark).toBeFocused();

    const row = page.locator('[data-bookmark-id="1"]');
    await row.getByRole('button', { name: 'Delete bookmark' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete bookmark' });
    await dialog.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    const deleteButton = row.getByRole('button', { name: 'Delete bookmark' });
    await expect(deleteButton).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    const confirmDelete = dialog.getByRole('button', { name: 'Confirm delete bookmark' });
    await confirmDelete.focus();
    await page.keyboard.press('Enter');
    await expect(row).not.toBeVisible();
    await expect(page.locator('[data-bookmark-id="2"]')).toBeFocused();
  });
});

test.describe('browser pagination and lifecycle evidence', () => {
  test('paginates 1000 bookmarks and 205 tags with long metadata', async ({ page }, testInfo) => {
    await connect(page, 'performance');
    await queue(page);
    const paginationStartedAt = Date.now();
    // Keep this test on the explicit normal-pagination control. The app also
    // supports an IntersectionObserver sentinel, which is not the scenario
    // being measured here.
    await page.locator('.bookmark-sentinel').evaluate((element) => {
      (element as HTMLElement).style.display = 'none';
    });

    for (let pageNumber = 1; pageNumber < 50; pageNumber += 1) {
      await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(page.locator('[role="listitem"]')).toHaveCount((pageNumber + 1) * 20);
    }
    await expect(page.getByRole('button', { name: 'Load more' })).not.toBeVisible();
    await expect(page.locator('[role="listitem"]')).toHaveCount(1000);
    await expect(page.getByRole('heading', { name: /Synthetic bookmark 1000/ })).toBeVisible();
    await expect(
      page.getByText(/Long deterministic description for synthetic bookmark 1000/),
    ).toBeVisible();
    const bookmarkObservation = {
      ...(await browserMetrics(page)),
      paginationRenderMs: Date.now() - paginationStartedAt,
    };

    const bookmarkOffsets = (await commands(page))
      .filter(
        ({ command, input }) => command === 'list_bookmarks' && input && typeof input === 'object',
      )
      .map(({ input }) => (input as { offset: number; scope: string }).offset);
    expect(bookmarkOffsets).toEqual(Array.from({ length: 50 }, (_, index) => index * 20));

    await page.locator('aside').getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tag catalogue' })).toBeVisible();
    await expect(page.locator('.tag-row')).toHaveCount(205);
    const tagOffsets = (await commands(page))
      .filter(({ command, input }) => command === 'list_tags' && input && typeof input === 'object')
      .map(({ input }) => (input as { offset: number }).offset);
    expect(tagOffsets).toEqual([0, 100, 200]);

    const observation = {
      bookmarks: bookmarkObservation,
      tags: await browserMetrics(page),
      paginationAndTagRenderMs: Date.now() - paginationStartedAt,
    };
    console.info(`[large-list-observation] ${JSON.stringify(observation)}`);
    await testInfo.attach('large-list-observation.json', {
      body: JSON.stringify(observation, null, 2),
      contentType: 'application/json',
    });
  });

  test('echoes search input immediately and emits one request after the 300ms debounce', async ({
    page,
  }) => {
    await connect(page, 'performance');
    await queue(page);
    const search = page.getByLabel('Search bookmarks');
    const before = (await commands(page)).filter(
      ({ command }) => command === 'list_bookmarks',
    ).length;
    await search.fill('Synthetic bookmark 999');
    await expect(search).toHaveValue('Synthetic bookmark 999');
    await expect(page.getByRole('status')).toContainText('Search draft: Synthetic bookmark 999');
    await page.waitForTimeout(250);
    expect(
      (await commands(page)).filter(({ command }) => command === 'list_bookmarks').length,
    ).toBe(before);
    await page.waitForTimeout(100);
    await expect(page.locator('[data-bookmark-id="999"]')).toBeVisible();
    const matching = (await commands(page)).filter(
      ({ command, input }) =>
        command === 'list_bookmarks' &&
        input &&
        typeof input === 'object' &&
        (input as { query?: string }).query === 'Synthetic bookmark 999',
    );
    expect(matching).toHaveLength(1);
  });

  test('keeps route and dialog listener/request counts stable over 20 cycles', async ({ page }) => {
    await page.addInitScript(() => {
      let activeListeners = 0;
      const originalAdd = EventTarget.prototype.addEventListener;
      const originalRemove = EventTarget.prototype.removeEventListener;
      const records = new WeakMap<EventTarget, Map<string, Set<EventListener>>>();
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (listener && (this === window || this === document)) {
          const byType = records.get(this) ?? new Map<string, Set<EventListener>>();
          const listeners = byType.get(type) ?? new Set<EventListener>();
          if (!listeners.has(listener as EventListener)) {
            listeners.add(listener as EventListener);
            activeListeners += 1;
          }
          byType.set(type, listeners);
          records.set(this, byType);
        }
        return originalAdd.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (this === window || this === document) {
          const listeners = records.get(this)?.get(type);
          if (listeners?.delete(listener as EventListener)) activeListeners -= 1;
        }
        return originalRemove.call(this, type, listener, options);
      };
      Object.defineProperty(window, '__linkdqueueActiveListeners', {
        configurable: true,
        get: () => activeListeners,
      });
    });
    await connect(page, 'performance');
    await queue(page);
    // Mount each routed list once before taking the listener baseline. The
    // first visit creates the route's delegated handlers; subsequent cycles
    // must not add more handlers.
    await page.locator('aside').getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
    await page.locator('aside').getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tag catalogue' })).toBeVisible();
    await queue(page);
    const initialListeners = await page.evaluate(
      () =>
        (window as Window & { __linkdqueueActiveListeners?: number }).__linkdqueueActiveListeners ??
        0,
    );

    for (let cycle = 0; cycle < 20; cycle += 1) {
      const start = (await commands(page)).length;
      await page.locator('aside').getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
      await page.locator('aside').getByRole('button', { name: 'Tags', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Tag catalogue' })).toBeVisible();
      await queue(page);
      await page.getByRole('button', { name: 'New bookmark' }).click();
      const addDialog = page.getByRole('dialog', { name: 'Add bookmark' });
      await expect(addDialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(addDialog).not.toBeVisible();
      const delta = (await commands(page))
        .slice(start)
        .filter(({ command }) => command === 'list_bookmarks');
      expect(delta).toHaveLength(2);
      expect(delta.every(({ input }) => (input as { offset: number }).offset === 0)).toBeTruthy();
      const listeners = await page.evaluate(
        () =>
          (window as Window & { __linkdqueueActiveListeners?: number })
            .__linkdqueueActiveListeners ?? 0,
      );
      expect(listeners).toBe(initialListeners);
    }
  });
});
