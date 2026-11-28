import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';

/** The shop's name, after the page's name in every title. */
export const SHOP_NAME = 'Shop';

/**
 * Titles each page "<page> - Shop", from the route's `title`: the page's name first, since a
 * screen reader reads it first and a tab shows its start. The separator is a plain hyphen with
 * spaces, which screen readers usually read as a short pause, rather than a symbol such as a
 * middle dot or a bar, which some read out by name.
 */
@Injectable({ providedIn: 'root' })
export class ShopTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page === undefined ? SHOP_NAME : `${page} - ${SHOP_NAME}`);
  }
}
