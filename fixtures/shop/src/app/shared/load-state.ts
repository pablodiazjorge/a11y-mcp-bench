import { Component, DestroyRef, effect, inject, input, output } from '@angular/core';
import { StatusAnnouncer } from '../shell/status-announcer';

/** Where a page's data stands. */
export type LoadStatus = 'loading' | 'error' | 'done';

/**
 * The state of a page's data. While the data loads, the page shows "Loading products…", and the
 * shell's status region, which is in the page from the start, says it too, politely. When the data
 * arrives, the region says the `done` text, if any, such as "16 products". An error is an alert
 * (`role="alert"`), read as soon as it appears, with a button to try again. When the page goes, the
 * region falls silent.
 */
@Component({
  selector: 'app-load-state',
  templateUrl: './load-state.html',
  styleUrl: './load-state.css',
})
export class LoadState {
  readonly status = input.required<LoadStatus>();
  /** What is loading, in a few words, such as "products". */
  readonly what = input.required<string>();
  /** What the status region says once the data has arrived, such as "16 products"; nothing by default. */
  readonly done = input('');
  /** The user asks to load the data again. */
  readonly retry = output();

  constructor() {
    const announcer = inject(StatusAnnouncer);
    effect(() => {
      const status = this.status();
      announcer.say(
        status === 'loading' ? `Loading ${this.what()}…` : status === 'done' ? this.done() : '',
      );
    });
    inject(DestroyRef).onDestroy(() => {
      announcer.say('');
    });
  }
}
