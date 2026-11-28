import type { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatPrice, productResource } from '../../data/products-api';
import { LoadState, type LoadStatus } from '../../shared/load-state';

/** A placeholder for the product page, with its data and its states; a later change builds it. */
@Component({
  selector: 'app-product-page',
  imports: [RouterLink, LoadState],
  templateUrl: './product-page.html',
  styleUrl: './product-page.css',
})
export class ProductPage {
  /** The product's id, from the route. */
  readonly id = input.required<string>();
  protected readonly product = productResource(() => this.id());
  protected readonly item = computed(() =>
    this.product.hasValue() ? this.product.value() : undefined,
  );
  /** The API knows no product with this id. */
  protected readonly notFound = computed(
    () => (this.product.error() as HttpErrorResponse | undefined)?.status === 404,
  );
  protected readonly status = computed<LoadStatus>(() => {
    if (this.item() !== undefined || this.notFound()) return 'done';
    return this.product.error() === undefined ? 'loading' : 'error';
  });
  /**
   * One heading for every state, whose text changes: focus moves to it after a navigation, and a
   * heading replaced when the data arrives would take the focus with it.
   */
  protected readonly heading = computed(
    () => this.item()?.name ?? (this.notFound() ? 'Product not found' : 'Product'),
  );
  protected readonly formatPrice = formatPrice;
}
