import { type HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationInitStatus, ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { Subject, switchMap, take } from 'rxjs';
import { App } from './app';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { MOCK_MODE, mockApiInterceptor } from './data/mock-api';
import { ShopTitleStrategy } from './shell/shop-title-strategy';

/** The shell at `url`, after its first navigation. */
async function open(url: string, interceptors: HttpInterceptorFn[] = []) {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(withInterceptors([...interceptors, mockApiInterceptor])),
      { provide: MOCK_MODE, useValue: 'data' },
      { provide: TitleStrategy, useClass: ShopTitleStrategy },
    ],
  });
  const fixture = TestBed.createComponent(App);
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;
  /** Goes to another URL inside the app, as a link does. */
  const go = async (next: string) => {
    await router.navigateByUrl(next);
    await fixture.whenStable();
  };
  return { page, router, go, fixture };
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe('the shell', () => {
  it('has one banner, one named navigation, one main and one footer', async () => {
    const { page } = await open('/catalog');

    expect(page.querySelectorAll('header')).toHaveLength(1);
    expect(page.querySelectorAll('footer')).toHaveLength(1);
    expect(page.querySelectorAll('main')).toHaveLength(1);
    const navigations = [...page.querySelectorAll('nav')];
    expect(navigations.map((nav) => nav.getAttribute('aria-label'))).toEqual(['Main']);
    const links = [...page.querySelectorAll('nav a')].map((link) => link.textContent.trim());
    expect(links).toEqual(['Catalog', 'Cart', 'Checkout']);
  });

  it('starts with a skip link to the main content, which can take focus', async () => {
    const { page } = await open('/catalog');

    const first = page.querySelector<HTMLAnchorElement>(FOCUSABLE);
    expect(first?.textContent.trim()).toBe('Skip to main content');
    expect(first?.getAttribute('href')).toBe('#main');
    const target = page.querySelector('#main');
    expect(target?.tagName).toBe('MAIN');
    expect(target?.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus to the main content without leaving the page, under the base href of index.html', async () => {
    // index.html sets <base href="/">, against which a plain "#main" means "/#main": a link that
    // the browser followed would load that document and open the catalog.
    const base = document.createElement('base');
    base.href = '/';
    document.head.prepend(base);
    try {
      const { page, router } = await open('/cart');
      const link = page.querySelector<HTMLAnchorElement>('.skip-link');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
      expect(router.url).toBe('/cart');
      expect(document.activeElement).toBe(page.querySelector('#main'));
    } finally {
      base.remove();
    }
  });

  it('marks the link of the current page', async () => {
    const { page } = await open('/cart');

    const current = [...page.querySelectorAll('nav a[aria-current="page"]')];
    expect(current.map((link) => link.textContent.trim())).toEqual(['Cart']);
  });
});

describe('the routes', () => {
  it.each([
    ['/catalog', 'Catalog - Shop', 'Catalog'],
    ['/product/leather-boots', 'Product - Shop', 'Leather boots'],
    ['/cart', 'Cart - Shop', 'Cart'],
    ['/checkout', 'Checkout - Shop', 'Checkout'],
    ['/no-such-page', 'Page not found - Shop', 'Page not found'],
  ])('%s is titled %j and shows its heading', async (url, title, heading) => {
    const { page } = await open(url);

    expect(TestBed.inject(Title).getTitle()).toBe(title);
    expect(page.querySelector('main h1')?.textContent.trim()).toBe(heading);
  });

  it('sends the root URL to the catalog', async () => {
    const { router } = await open('/');

    expect(router.url).toBe('/catalog');
  });
});

describe('focus on navigation', () => {
  it('stays where it is on the first load', async () => {
    await open('/catalog');

    expect(document.activeElement).toBe(document.body);
  });

  it("moves to the new page's heading after a navigation inside the app", async () => {
    const { page, go } = await open('/catalog');
    await go('/cart');

    const heading = page.querySelector<HTMLElement>('main h1');
    expect(heading?.textContent.trim()).toBe('Cart');
    expect(document.activeElement).toBe(heading);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
  });

  it.each([
    ['the query string', '/catalog?size=m'],
    ['the fragment', '/catalog#top'],
  ])('stays where the user left it when only %s changes', async (_case, next) => {
    const { page, go } = await open('/catalog');
    const link = page.querySelector<HTMLElement>('nav a');
    link?.focus();

    await go(next);

    expect(document.activeElement).toBe(link);
  });
});

describe('the status region', () => {
  it('is in the shell from the start, empty', () => {
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes)] });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const regions = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="status"]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.textContent.trim()).toBe('');
  });

  it('says what the page loaded, and falls silent on a page with nothing to load', async () => {
    const { page, go } = await open('/catalog');
    const region = page.querySelector('[role="status"]');
    expect(region?.textContent.trim()).toBe('16 products');

    await go('/cart');

    expect(page.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent.trim()).toBe('');
  });
});

describe('focus on a product page', () => {
  it('stays on the heading while the product loads, and the heading then names it', async () => {
    // Holds the product's answer until the test lets it go, as a slow answer would.
    const answer = new Subject<void>();
    const hold: HttpInterceptorFn = (request, next) =>
      request.url.includes('/api/products/')
        ? answer.pipe(
            take(1),
            switchMap(() => next(request)),
          )
        : next(request);
    const { page, router, fixture } = await open('/catalog', [hold]);

    await router.navigateByUrl('/product/leather-boots');
    TestBed.inject(ApplicationRef).tick();
    const heading = page.querySelector<HTMLElement>('main h1');
    expect(heading?.textContent.trim()).toBe('Product');
    expect(document.activeElement).toBe(heading);

    answer.next();
    await fixture.whenStable();

    expect(document.activeElement).toBe(heading);
    expect(heading?.textContent.trim()).toBe('Leather boots');
  });
});

describe('the mock mode', () => {
  it('is read when the app starts, before any page asks for data', async () => {
    let reads = 0;
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        {
          provide: MOCK_MODE,
          useFactory: () => {
            reads++;
            return 'data';
          },
        },
      ],
    });

    await TestBed.inject(ApplicationInitStatus).donePromise;

    expect(reads).toBe(1);
  });
});
