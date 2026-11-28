import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The banner: the shop's name and the main navigation. */
@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
})
export class SiteHeader {}
