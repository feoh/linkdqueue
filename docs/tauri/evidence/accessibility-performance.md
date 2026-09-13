# Q05 accessibility and large-list evidence

Status: automated Linux browser evidence complete on 2026-09-13. Native
screen-reader acceptance remains an explicit manual gap, described below.

## Test environment

- Revision tested: `1e0541c721eb` plus the Q05 worktree changes.
- Host: CachyOS Linux `7.2.3-1-cachyos`, Wayland, x86_64.
- CPU/memory: Intel Core i9-14900K, 32 logical CPUs, 60 GiB RAM.
- Runtime: Node.js 24.15.0, npm 11.12.1, Playwright 1.63.0, Chromium, and
  `@axe-core/playwright` 4.11.1 (`axe-core` 4.11.4).
- Harness: the local Vite browser entry with an in-memory typed bridge. No real
  Linkding URL, token, network request, credential store, or production data was
  used.
- Browser viewports: 1280x800 (`desktop`) and 800x600 (`compact`).

## Automated accessibility evidence

Run from `desktop/`:

```sh
npm run test:e2e
```

The final run passed all 26 browser tests in 45.5 seconds. The Q05 coverage in
`tests/e2e/accessibility.spec.ts` establishes:

- zero axe violations on Queue, Archive, Tags, All-tagged, Settings, Add
  Bookmark, Edit Tags, and Delete Bookmark in representative light
  (Catppuccin Latte) and dark (Catppuccin Mocha) palettes at baseline and 200%
  text;
- zero axe violations for Queue and its normal action states in all eight named
  themes, plus the System theme under an emulated dark color scheme;
- no document-level horizontal overflow in each scanned state, including
  800x600 at 200% text;
- keyboard activation of Add and Delete, Escape/Cancel focus restoration,
  focus on the next surviving row after deletion, and reduced-motion token
  application;
- valid combobox/listbox ownership for tag suggestions without nested
  interactive roles.

The scans found and the implementation corrected serious contrast failures in
sidebar selections, primary/secondary actions, metadata, and destructive
controls. Catppuccin Latte, Dracula, Tokyo Day, Gruvbox, One Dark, and System
Dark tokens needed adjustments. The compact breakpoint was widened to prevent
200% text from forcing the sidebar and toolbar beyond the 800px viewport.

These checks enforce no axe violations, which is stricter than Q05's stated
serious/critical-only threshold. Axe does not prove that every assistive
technology interaction is correct.

## Large-list and lifecycle observations

The deterministic performance dataset contains 1,000 bookmarks with long
metadata and 205 tags. It is consumed through the normal 20-bookmark and
100-tag pagination paths. The test verified bookmark offsets `0..980` in steps
of 20, tag offsets `[0, 100, 200]`, all 1,000 unique rendered rows, and the final
long-metadata record.

During the final parallel run, fresh browser-context navigation completed in
125-333 ms. Driving 49 Load More actions and waiting for each accumulated page
took 42.2-42.4 seconds; this is end-to-end Playwright cycle time, not a claim
about one user interaction or a production Tauri build. With all 1,000 rows
mounted, Chromium reported 26,288 DOM elements and 97-177 MB of used JS heap.
After navigating to the 205-tag catalogue, the live DOM dropped to 692 elements;
Chromium had not reclaimed the reported heap during the observation window.
No garbage collection was forced, so the retained heap measurement is not by
itself evidence of a leak.

A separate test confirms that search text echoes before the settled request,
that no request occurs at 250 ms, and that exactly one matching request occurs
after the 300 ms debounce. Another test performs 20 Queue/Archive/Tags/dialog
cycles: every cycle emits only the two expected offset-zero bookmark requests,
and the instrumented window/document listener count remains equal to its
post-warmup baseline.

The evidence does not justify adding virtualization now. The application loads
20 rows initially, the large accumulated DOM requires 49 explicit user paging
actions, and the normal input/debounce and lifecycle checks remain stable.
Virtualization should remain a separate decision if production Tauri profiling
or actual usage shows that users commonly accumulate hundreds of rows.

## Manual acceptance gap and waiver recommendation

Orca is installed on the Linux host, but this agent cannot perform or truthfully
assess an auditory screen-reader session. Native Tauri/WebKit accessibility-tree
behavior also is not represented by Chromium axe results. No screen-reader pass
is claimed.

For this personal application, it is reasonable to accept Q05 without blocking
on that manual pass if the owner does not rely on a screen reader: keyboard,
focus, semantic, contrast, text-scale, reduced-motion, pagination, and lifecycle
regressions now have repeatable CI coverage. If screen-reader use is a release
requirement, run one owner-observed Orca + Linux Tauri workflow before treating
native OS accessibility as accepted.
