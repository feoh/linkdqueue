import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = async (relativePath) =>
  JSON.parse(await readFile(path.join(here, '..', relativePath), 'utf8'));

const settings = await fixture('tests/fixtures/contracts/settings.json');
const bookmark = await fixture('tests/fixtures/contracts/bookmark.json');
const linkdingBookmark = await fixture('tests/fixtures/linkding/bookmarks-page-1.json');
const bridgeSource = await readFile(path.join(here, '..', 'src/lib/api/bridge.ts'), 'utf8');

const requiredSettings = [
  'schemaVersion',
  'generation',
  'connectionState',
  'canonicalBaseUrl',
  'credentialStatus',
  'display',
];
for (const field of requiredSettings) {
  if (!(field in settings)) {
    throw new Error(`Missing settings contract field: ${field}`);
  }
}

for (const field of ['id', 'url', 'isArchived', 'isRead', 'tagNames']) {
  if (!(field in bookmark)) {
    throw new Error(`Missing frontend bookmark contract field: ${field}`);
  }
}

for (const item of linkdingBookmark.results) {
  if (!('unread' in item) || 'is_read' in item) {
    throw new Error('Linkding transport contract must use unread, never is_read');
  }
}

const commands = [
  'get_settings',
  'test_connection',
  'save_connection',
  'clear_connection',
  'set_display_preferences',
  'list_bookmarks',
  'list_tags',
  'create_bookmark',
  'mark_read',
  'replace_bookmark_tags',
  'archive_bookmark',
  'unarchive_bookmark',
  'delete_bookmark',
  'open_external_url',
];
for (const command of commands) {
  if (!bridgeSource.includes(`'${command}'`)) {
    throw new Error(`Missing typed bridge command wrapper: ${command}`);
  }
}
for (const forbidden of ['fetch(', 'axios', 'get_token', 'localStorage']) {
  if (bridgeSource.includes(forbidden)) {
    throw new Error(`Forbidden direct credential/network access in bridge: ${forbidden}`);
  }
}
