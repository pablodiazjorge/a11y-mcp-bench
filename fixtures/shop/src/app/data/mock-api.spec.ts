import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { MOCK_MODE, mockApiInterceptor, type MockMode, readMockMode } from './mock-api';
import type { Product } from './product';
import { PRODUCTS } from './products';

/** An HttpClient behind the mock API, in `mode`. */
function client(mode: MockMode) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([mockApiInterceptor])),
      provideHttpClientTesting(),
      { provide: MOCK_MODE, useValue: mode },
    ],
  });
  return TestBed.inject(HttpClient);
}

/** The error that a request ends with. */
async function failure(request: Promise<unknown>): Promise<HttpErrorResponse> {
  try {
    await request;
  } catch (error) {
    if (error instanceof HttpErrorResponse) return error;
    throw error;
  }
  throw new Error('the request did not fail');
}

describe('readMockMode', () => {
  it.each([
    ['?mock=loading', 'loading'],
    ['?mock=error', 'error'],
    ['?category=shoes&mock=error', 'error'],
    ['', 'data'],
    ['?mock=', 'data'],
    ['?mock=other', 'data'],
    ['?MOCK=error', 'data'],
  ])('reads %j as %s', (search, mode) => {
    expect(readMockMode(search)).toBe(mode);
  });
});

describe('the mock API', () => {
  it('answers the list of products at once, with every product', async () => {
    const http = client('data');

    const products = await firstValueFrom(http.get<Product[]>('/api/products'));

    expect(products.map(({ id }) => id)).toEqual(PRODUCTS.map(({ id }) => id));
  });

  it('filters the list by the query parameters of the request', async () => {
    const http = client('data');

    const shoes = await firstValueFrom(
      http.get<Product[]>('/api/products?category=shoes&maxPrice=9000'),
    );

    expect(shoes.map(({ id }) => id)).toEqual(['canvas-sneakers', 'running-shoes']);
  });

  it('answers one product, as a copy that a caller cannot change in the catalog', async () => {
    const http = client('data');

    const product = await firstValueFrom(http.get<Product>('/api/products/linen-shirt'));
    (product as { name: string }).name = 'Changed';

    expect(PRODUCTS.find(({ id }) => id === 'linen-shirt')?.name).toBe('Linen shirt');
  });

  it.each([
    ['an unknown product', '/api/products/no-such-product'],
    ['an unknown route of the API', '/api/orders'],
  ])('answers %s with 404', async (_case, url) => {
    const http = client('data');

    expect((await failure(firstValueFrom(http.get(url)))).status).toBe(404);
  });

  it('refuses a write, which the app never sends at load', async () => {
    const http = client('data');

    expect((await failure(firstValueFrom(http.post('/api/products', {})))).status).toBe(405);
  });

  it('answers every request with 500 in the error mode', async () => {
    const http = client('error');

    expect((await failure(firstValueFrom(http.get('/api/products')))).status).toBe(500);
  });

  it('never answers in the loading mode, nor ends, however long it waits', () => {
    // Fake timers run every timer at once: an answer that a timer delays would show here.
    vi.useFakeTimers();
    try {
      const http = client('loading');
      const seen: string[] = [];

      const subscription = http.get('/api/products').subscribe({
        next: () => seen.push('next'),
        error: () => seen.push('error'),
        complete: () => seen.push('complete'),
      });
      vi.runAllTimers();

      expect(seen).toEqual([]);
      subscription.unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes on a request outside /api/, to the network', () => {
    const http = client('data');

    http.get('/assets/x.json').subscribe();

    TestBed.inject(HttpTestingController).expectOne('/assets/x.json');
  });

  it('answers an API URL written relative to the page, or in full, on its own origin', async () => {
    const http = client('data');
    const origin = new URL(document.baseURI).origin;

    for (const url of ['api/products', `${origin}/api/products`]) {
      const products = await firstValueFrom(http.get<Product[]>(url));
      expect(products).toHaveLength(PRODUCTS.length);
    }
  });

  it('passes on a request to /api/ on another origin, to the network', () => {
    const http = client('data');

    http.get('http://other.test/api/products').subscribe();

    TestBed.inject(HttpTestingController).expectOne('http://other.test/api/products');
  });
});
