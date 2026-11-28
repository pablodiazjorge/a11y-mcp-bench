import { TestBed } from '@angular/core/testing';
import { StatusAnnouncer } from '../shell/status-announcer';
import { LoadState, type LoadStatus } from './load-state';

async function render(status: LoadStatus, done = '') {
  const fixture = TestBed.createComponent(LoadState);
  fixture.componentRef.setInput('status', status);
  fixture.componentRef.setInput('what', 'products');
  fixture.componentRef.setInput('done', done);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const announced = () => TestBed.inject(StatusAnnouncer).message();
  return { fixture, element, announced };
}

describe('LoadState', () => {
  it('shows that the data loads, and has the status region say it', async () => {
    const { element, announced } = await render('loading');

    expect(element.querySelector('.message')?.textContent.trim()).toBe('Loading products…');
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(announced()).toBe('Loading products…');
  });

  it('has the status region say what the page asks when the data arrives, and shows nothing', async () => {
    const { fixture, element, announced } = await render('loading');

    fixture.componentRef.setInput('status', 'done');
    fixture.componentRef.setInput('done', '16 products');
    await fixture.whenStable();

    expect(element.textContent.trim()).toBe('');
    expect(announced()).toBe('16 products');
  });

  it('shows an error as an alert, with a button to try again, and silences the region', async () => {
    const { fixture, element, announced } = await render('error');
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);

    expect(announced()).toBe('');
    const alert = element.querySelector('[role="alert"]');
    expect(alert?.querySelector('p')?.textContent.trim()).toBe('The products could not be loaded.');
    const button = alert?.querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    button?.click();
    expect(retried).toBe(1);
  });

  it('silences the region when its page goes', async () => {
    const { fixture, announced } = await render('loading');

    fixture.destroy();

    expect(announced()).toBe('');
  });
});
