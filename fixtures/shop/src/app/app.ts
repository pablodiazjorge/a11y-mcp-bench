import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** The root of the app: it shows the page of the current route. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
