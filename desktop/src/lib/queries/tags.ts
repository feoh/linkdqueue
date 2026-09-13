import type { LinkdqueueBridge } from '../api/bridge';
import type { CommandEnvelope, Generation, Page, Tag } from '../api/types';

export const TAG_PAGE_LIMIT = 100;
export type TagPage = CommandEnvelope<Page<Tag>>;
export type TagCatalogueStatus = 'idle' | 'loading' | 'partial' | 'ready' | 'error';
export type TagCatalogueSnapshot = {
  generation: Generation | null;
  status: TagCatalogueStatus;
  tags: Tag[];
  selectedNames: string[];
  failedOffset: number | null;
  error: unknown;
  revision: number;
};

export class TagCatalogueError extends Error {
  readonly code = 'tag_pagination_protocol';

  constructor(message: string) {
    super(message);
    this.name = 'TagCatalogueError';
  }
}

export class StaleTagResponseError extends Error {
  constructor() {
    super('The tag response is no longer current.');
    this.name = 'StaleTagResponseError';
  }
}

function compareNames(left: string, right: string): number {
  const leftKey = left.toLocaleLowerCase('en-US');
  const rightKey = right.toLocaleLowerCase('en-US');
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function nextOffset(page: TagPage, offset: number): number | null {
  if (page.data.results.length === 0 || page.data.next === null) return null;
  const next = offset + page.data.results.length;
  if (next <= offset) throw new TagCatalogueError('Linkding returned a non-advancing tag offset.');
  return next;
}

function allTags(pages: readonly TagPage[]): Tag[] {
  const tags: Tag[] = [];
  for (const page of pages) tags.push(...page.data.results);
  return tags;
}

function hasNewTags(page: TagPage, existing: readonly Tag[]): boolean {
  const ids = new Set(existing.map(({ id }) => id));
  const names = new Set(existing.map(({ name }) => name));
  return page.data.results.some(({ id, name }) => !ids.has(id) && !names.has(name));
}

function sortedUnique(tags: readonly Tag[]): Tag[] {
  const byId = new Map<number, Tag>();
  const byName = new Set<string>();
  for (const tag of tags) {
    if (byId.has(tag.id) || byName.has(tag.name)) continue;
    byId.set(tag.id, tag);
    byName.add(tag.name);
  }
  return [...byId.values()].sort((left, right) => compareNames(left.name, right.name));
}

export class TagCatalogue {
  private generation: Generation | null = null;
  private status: TagCatalogueStatus = 'idle';
  private pages: TagPage[] = [];
  private selectedNames: string[] = [];
  private failedOffset: number | null = null;
  private currentError: unknown = null;
  private revision = 0;
  private inFlight: Promise<TagCatalogueSnapshot> | null = null;

  constructor(private readonly bridge: LinkdqueueBridge) {}

  get snapshot(): TagCatalogueSnapshot {
    return {
      generation: this.generation,
      status: this.status,
      tags: sortedUnique(allTags(this.pages)),
      selectedNames: [...this.selectedNames],
      failedOffset: this.failedOffset,
      error: this.currentError,
      revision: this.revision,
    };
  }

  setSelectedNames(names: readonly string[]): void {
    this.selectedNames = [...new Set(names)];
  }

  load(generation: Generation): Promise<TagCatalogueSnapshot> {
    if (this.status === 'ready' && this.generation === generation)
      return Promise.resolve(this.snapshot);
    if (this.generation === generation && this.inFlight) return this.inFlight;
    return this.start(generation, 0, true);
  }

  refresh(): Promise<TagCatalogueSnapshot> {
    if (this.generation === null) return Promise.resolve(this.snapshot);
    return this.start(this.generation, 0, true);
  }

  retry(): Promise<TagCatalogueSnapshot> {
    if (this.generation === null || this.failedOffset === null)
      return Promise.resolve(this.snapshot);
    return this.start(this.generation, this.failedOffset, false);
  }

  /** Invalidate only after a confirmed bookmark create or tag replacement. */
  invalidateAfterConfirmedMutation(confirmed: boolean): void {
    if (!confirmed) return;
    this.revision += 1;
    this.status = 'idle';
    this.pages = [];
    this.inFlight = null;
    this.failedOffset = null;
    this.currentError = null;
  }

  private start(
    generation: Generation,
    offset: number,
    reset: boolean,
  ): Promise<TagCatalogueSnapshot> {
    this.revision += 1;
    const revision = this.revision;
    this.generation = generation;
    this.status = reset ? 'loading' : 'partial';
    if (reset) this.pages = [];
    this.failedOffset = null;
    this.currentError = null;
    const promise = this.fetchPages(generation, offset, revision);
    this.inFlight = promise;
    void promise.then(
      () => {
        if (this.inFlight === promise) this.inFlight = null;
      },
      () => {
        if (this.inFlight === promise) this.inFlight = null;
      },
    );
    return promise;
  }

  private async fetchPages(
    generation: Generation,
    initialOffset: number,
    revision: number,
  ): Promise<TagCatalogueSnapshot> {
    let offset = initialOffset;
    try {
      while (true) {
        const page = await this.bridge.listTags({ generation, offset, limit: TAG_PAGE_LIMIT });
        if (revision !== this.revision || page.generation !== generation) {
          throw new StaleTagResponseError();
        }
        const existing = allTags(this.pages);
        if (page.data.results.length > 0 && !hasNewTags(page, existing)) {
          throw new TagCatalogueError('Linkding returned no new tags.');
        }
        this.pages = [...this.pages.filter((current) => current !== page), page];
        const next = nextOffset(page, offset);
        if (next === null) {
          this.status = 'ready';
          return this.snapshot;
        }
        this.status = 'partial';
        offset = next;
      }
    } catch (error: unknown) {
      if (revision === this.revision && !(error instanceof StaleTagResponseError)) {
        this.status = 'error';
        this.failedOffset = offset;
        this.currentError = error;
      }
      throw error;
    }
  }
}
