import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { MOCK_MODE, mockApiInterceptor, type MockMode } from '../../data/mock-api';
import { StatusAnnouncer } from '../../shell/status-announcer';

/** The product page at `/product/<id>`, with the mock API in `mode`. */
async function product(id: string, mode: MockMode = 'data'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(withInterceptors([mockApiInterceptor])),
      { provide: MOCK_MODE, useValue: mode },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await TestBed.inject(Router).navigateByUrl(`/product/${id}`);
  harness.detectChanges();
  // The status region gets its text after its first render.
  harness.detectChanges();
  // A request that never ends keeps the app from being stable, so the loading state is read at once.
  if (mode !== 'loading') await harness.fixture.whenStable();
  const page = harness.routeNativeElement;
  if (page === null) throw new Error('the route shows no page');
  return page;
}

describe('the product page', () => {
  it('shows the product of the id in the URL, with its picture and price', async () => {
    const page = await product('leather-boots');

    expect(page.querySelector('h1')?.textContent.trim()).toBe('Leather boots');
    expect(page.querySelector('img')?.getAttribute('alt')).toBe('Dark brown ankle boot, side view');
    expect(page.textContent).toContain('€129.00');
  });

  it('says that the product does not exist, for an unknown id, with a way back', async () => {
    const page = await product('no-such-product');

    expect(page.querySelector('h1')?.textContent.trim()).toBe('Product not found');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/catalog');
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it('says that the product loads, while it does', async () => {
    const page = await product('leather-boots', 'loading');

    expect(page.querySelector('.message')?.textContent.trim()).toBe('Loading product…');
    expect(TestBed.inject(StatusAnnouncer).message()).toBe('Loading product…');
  });

  it('says that the product could not be loaded, when the API fails', async () => {
    const page = await product('leather-boots', 'error');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'The product could not be loaded.',
    );
  });
});
