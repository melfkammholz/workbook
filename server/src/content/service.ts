import { Content, contentSignature, loadContent } from './loader.js';

/**
 * Holds the loaded content and transparently reloads it when files change,
 * so a `git pull` (or an author editing) shows up without restarting.
 */
export class ContentService {
  private content: Content;
  private signature: string;
  private checkedAt = 0;

  constructor(
    private readonly dir: string,
    private readonly onReload: (c: Content) => void = () => {},
    private readonly minIntervalMs = 1000,
  ) {
    this.content = loadContent(dir);
    this.signature = this.content.outline.version;
    onReload(this.content);
  }

  /** Picks up a change right away, for when the caller knows there was one. */
  reload(): void {
    this.checkedAt = 0;
    void this.current;
  }

  /** The current content; re-scans the directory at most once per interval. */
  get current(): Content {
    const now = Date.now();
    if (now - this.checkedAt >= this.minIntervalMs) {
      this.checkedAt = now;
      const sig = contentSignature(this.dir);
      if (sig !== this.signature) {
        this.content = loadContent(this.dir);
        this.signature = this.content.outline.version;
        this.onReload(this.content);
      }
    }
    return this.content;
  }
}
