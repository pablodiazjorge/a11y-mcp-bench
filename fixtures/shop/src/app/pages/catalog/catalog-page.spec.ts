import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { MOCK_MODE, mockApiInterceptor, type MockMode } from '../../data/mock-api';
import { StatusAnnouncer } from '../../shell/status-announcer';

const announced = () => TestBed.inject(StatusAnnouncer).message();

/** The catalog page, with the mock API in `mode`. */
async function catalog(mode: MockMode): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(withInterceptors([mockApiInterceptor])),
      { provide: MOCK_MODE, useValue: mode },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await TestBed.inject(Router).navigateByUrl('/catalog');
  harness.detectChanges();
  // The status region gets its text after its first render.
  harness.detectChanges();
  // A request that never ends keeps the app from being stable, so the loading state is read at once.
  if (mode !== 'loading') await harness.fixture.whenStable();
  const page = harness.routeNativeElement;
  if (page === null) throw new Error('the route shows no page');
  return page;
}

describe('the catalog page', () => {
  it('lists the products, each a link to its page', async () => {
    const page = await catalog('data');

    const links = [...page.querySelectorAll('li a')];
    expect(links).toHaveLength(16);
    expect(links[0]?.textContent.trim()).toBe('Linen shirt');
    expect(links[0]?.getAttribute('href')).toBe('/product/linen-shirt');
    expect(announced()).toBe('16 products');
  });

  it('says that the products load, while they do', async () => {
    const page = await catalog('loading');

    expect(page.querySelector('h1')?.textContent.trim()).toBe('Catalog');
    expect(page.querySelector('.message')?.textContent.trim()).toBe('Loading products…');
    expect(announced()).toBe('Loading products…');
  });

  it('says that the products could not be loaded, and offers to try again', async () => {
    const page = await catalog('error');

    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The products could not be loaded.');
    expect(alert?.querySelector('button')?.textContent.trim()).toBe('Try again');
  });
});
