import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { productListResource } from '../../data/products-api';
import { LoadState, type LoadStatus } from '../../shared/load-state';

/** A placeholder for the catalog page, with its data and its states; a later change builds it. */
@Component({
  selector: 'app-catalog-page',
  imports: [RouterLink, LoadState],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
})
export class CatalogPage {
  protected readonly products = productListResource(() => ({}));
  protected readonly list = computed(() =>
    this.products.hasValue() ? this.products.value() : undefined,
  );
  protected readonly status = computed<LoadStatus>(() => {
    if (this.list() !== undefined) return 'done';
    return this.products.error() === undefined ? 'loading' : 'error';
  });
  protected readonly count = computed(() => `${String(this.list()?.length ?? 0)} products`);
}
