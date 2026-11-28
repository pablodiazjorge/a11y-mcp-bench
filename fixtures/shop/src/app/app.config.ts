import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { MOCK_MODE, mockApiInterceptor } from './data/mock-api';
import { ShopTitleStrategy } from './shell/shop-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([mockApiInterceptor])),
    // The mock API's mode comes from the URL that the app starts at, before a link changes it.
    provideAppInitializer(() => {
      inject(MOCK_MODE);
    }),
    { provide: TitleStrategy, useClass: ShopTitleStrategy },
  ],
};
