import { Injectable, signal } from '@angular/core';

/**
 * The text of the app's one status region, a polite live region in the shell (`role="status"`).
 * The region is in the page from the app's first render, empty, so a screen reader reads each
 * change of its text: a region that comes into the page with its text may not be read. Pages set
 * the text through this service, such as "Loading products…" and then "16 products".
 */
@Injectable({ providedIn: 'root' })
export class StatusAnnouncer {
  private readonly text = signal('');
  readonly message = this.text.asReadonly();

  /** Sets the text of the status region; an empty text says nothing. */
  say(text: string): void {
    this.text.set(text);
  }
}
