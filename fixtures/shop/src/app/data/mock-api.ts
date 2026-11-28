// The mock API (ADR 0010): an interceptor that answers the app's `/api/` requests from the bundled
// catalog, at once, with no timer and no request to the network. An audit then always sees the
// data, and the URL policy of the server never meets an API request.

import {
  HttpErrorResponse,
  type HttpInterceptorFn,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { filterProducts, PRODUCTS_PATH, readFilter } from './products-api';
import { PRODUCTS } from './products';

/**
 * How the mock API answers: with the data, never (the loading state), or with an error. The page's
 * URL chooses it, as `?mock=loading` or `?mock=error`, so that an audit or a test can reach each
 * state by loading a URL; any other value, or none, gives the data.
 */
export type MockMode = 'data' | 'loading' | 'error';

/** Reads the mode from the query string of the page's URL, such as `?mock=error`. */
export function readMockMode(search: string): MockMode {
  const value = new URLSearchParams(search).get('mock');
  return value === 'loading' || value === 'error' ? value : 'data';
}

/**
 * The mode of this load of the app, read from the URL that the app started at: `app.config.ts`
 * reads it when the app starts, before any page asks for data. Only the interceptor uses it, and
 * no component knows the parameter. After a link inside the app, the URL no longer shows
 * `?mock=`, but the mode stays for the whole load of the app; the catalog's filters keep the
 * parameter in their URLs.
 */
export const MOCK_MODE = new InjectionToken<MockMode>('MOCK_MODE', {
  providedIn: 'root',
  factory: () => readMockMode(inject(DOCUMENT).location.search),
});

const PRODUCT_PATH = new RegExp(`^${PRODUCTS_PATH}/([^/]+)$`);

// A copy, so that a component that changes what it got does not change the catalog for the next
// request.
const answer = (request: HttpRequest<unknown>, body: unknown) =>
  of(
    new HttpResponse({
      status: 200,
      statusText: 'OK',
      url: request.url,
      body: structuredClone(body),
    }),
  );

const failure = (request: HttpRequest<unknown>, status: number, statusText: string) =>
  throwError(() => new HttpErrorResponse({ status, statusText, url: request.url }));

/** Answers a request of the API, at `url`, in the data mode. */
function serve(request: HttpRequest<unknown>, url: URL): Observable<HttpResponse<unknown>> {
  if (request.method !== 'GET') return failure(request, 405, 'Method Not Allowed');
  if (url.pathname === PRODUCTS_PATH) {
    return answer(request, filterProducts(PRODUCTS, readFilter(url.searchParams)));
  }
  const id = PRODUCT_PATH.exec(url.pathname)?.[1];
  const product = PRODUCTS.find((each) => each.id === decodeURIComponent(id ?? ''));
  return product === undefined ? failure(request, 404, 'Not Found') : answer(request, product);
}

/**
 * Answers the requests to `/api/` on the app's own origin, however the app writes their URL:
 * `/api/products`, `api/products` or the full address. Every other request goes on to the network.
 */
export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  const document = inject(DOCUMENT);
  const url = new URL(request.urlWithParams, document.baseURI);
  const own = url.origin === new URL(document.baseURI).origin;
  if (!own || !url.pathname.startsWith('/api/')) return next(request);
  const mode = inject(MOCK_MODE);
  // The loading state is an answer that never comes, not a timer: an audit waits for the page to
  // settle, and a timer could end during that wait, so the audit would see the data, not the
  // loading state.
  if (mode === 'loading') return NEVER;
  if (mode === 'error') return failure(request, 500, 'Internal Server Error');
  return serve(request, url);
};
