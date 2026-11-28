import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The page of a URL that the shop does not have. */
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  templateUrl: './not-found-page.html',
  styleUrl: './not-found-page.css',
})
export class NotFoundPage {}
