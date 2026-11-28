import { Component, DOCUMENT, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavigationFocus } from './shell/navigation-focus';
import { SiteFooter } from './shell/site-footer';
import { SiteHeader } from './shell/site-header';

/** The shell of every page: the skip link, the banner, the page itself and the footer. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeader, SiteFooter],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly document = inject(DOCUMENT);

  constructor() {
    inject(NavigationFocus).start();
  }

  /**
   * Moves focus to the main content and stays in the document. The plain `#main` of the link would
   * resolve against `<base href="/">`, load `/#main` and open the catalog from any page; a
   * fragment built from the current path would pass through the router as a navigation. The link
   * keeps its `href`, so that it is still a link.
   */
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }
}
