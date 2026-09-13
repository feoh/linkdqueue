import { describe, expect, it } from 'vitest';

import tauriConfig from '../src-tauri/tauri.conf.json';
import mainCapability from '../src-tauri/capabilities/main.json';

const bundledOrigins = ['tauri://localhost', 'http://tauri.localhost/', 'https://tauri.localhost/'];

function isBundledOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'tauri:' && url.hostname === 'localhost') ||
      ((url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname === 'tauri.localhost')
    );
  } catch {
    return false;
  }
}

describe('packaged security assumptions', () => {
  it('recognizes only the bundled application origins', () => {
    for (const origin of bundledOrigins) expect(isBundledOrigin(origin)).toBe(true);

    expect(isBundledOrigin('https://example.com/')).toBe(false);
    expect(isBundledOrigin('http://127.0.0.1:1420/')).toBe(false);
  });

  it('does not treat external Linkding URLs as renderer network origins', () => {
    expect(isBundledOrigin('https://bookmarks.example/api/')).toBe(false);
    expect(isBundledOrigin('http://localhost:9090/linkding/')).toBe(false);
  });

  it('pins the packaged policy to the narrow main capability', () => {
    const security = tauriConfig.app.security;
    expect(security.capabilities).toEqual(['main-capability']);
    expect(mainCapability.windows).toEqual(['main']);
    expect(mainCapability).not.toHaveProperty('urls');
    expect(mainCapability.permissions).not.toContain('core:default');
    expect(security.csp).not.toContain('unsafe-eval');
    expect(security.csp).not.toContain('https:');
    expect(security.csp).not.toContain('filesystem:');
    expect(security.csp).toContain('ipc:');
  });
});
