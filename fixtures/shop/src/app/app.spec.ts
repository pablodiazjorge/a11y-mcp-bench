import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { ShopTitleStrategy } from './shell/shop-title-strategy';

/** The shell at `url`, after its first navigation. */
async function open(url: string) {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [provideRouter(routes), { provide: TitleStrategy, useClass: ShopTitleStrategy }],
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
  return { page, router, go };
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
    ['/product/1', 'Product - Shop', 'Product'],
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
