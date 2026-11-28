import { afterNextRender, DestroyRef, DOCUMENT, inject, Injectable, Injector } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

/** The path of a URL of the app, without its query string or fragment. */
function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

/**
 * Moves focus to the new page's heading after each navigation inside the app to another page, not
 * on the first load, where the browser has just loaded a document and a screen reader announces
 * it. A single-page app does not load a new document, so without this, focus stays on the link
 * that was used, and a screen reader says nothing of the new page. Focus on the `h1` makes it read
 * the page's name, which is the announcement, and Tab goes on from the top of the new content.
 * A page with no `h1` gets focus on `main` instead. A navigation that changes only the query
 * string or the fragment, as a filter of the catalog does, stays on the same page, so focus stays
 * where the user left it.
 */
@Injectable({ providedIn: 'root' })
export class NavigationFocus {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private started = false;

  /** Starts listening to the router; the root component calls it once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    let previous: string | undefined;
    const subscription = this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const path = pathOf(event.urlAfterRedirects);
      const samePage = previous === undefined || previous === path;
      previous = path;
      if (samePage) return;
      afterNextRender(() => this.focusPage(), { injector: this.injector });
    });
    this.injector.get(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
    });
  }

  private focusPage(): void {
    const main = this.document.getElementById('main');
    const target = main?.querySelector<HTMLElement>('h1') ?? main;
    if (target === null || target === undefined) return;
    // A heading takes focus only from code, never from Tab.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  }
}
