import { TestBed } from '@angular/core/testing';
import { StartPage } from './start-page';

describe('StartPage', () => {
  it('carries the attribute of its own styles, so that an audit can name it', async () => {
    const fixture = TestBed.createComponent(StartPage);
    await fixture.whenStable();
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h1');

    expect(heading?.textContent).toBe('Shop');
    expect(heading?.getAttributeNames().some((name) => name.startsWith('_ngcontent-'))).toBe(true);
  });
});
