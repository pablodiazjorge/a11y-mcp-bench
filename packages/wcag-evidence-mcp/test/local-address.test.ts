// The third layer of the URL policy (ADR 0005): which addresses, as Playwright reports the one that
// the browser connected to, count as the local machine.

import { describe, expect, it } from 'vitest';
import { isLocalAddress } from '../src/core/url-policy.ts';

describe('isLocalAddress', () => {
  it.each([
    ['127.0.0.1', 'the IPv4 loopback address'],
    ['[::1]', 'the IPv6 loopback address, in brackets as Playwright writes it'],
  ])('accepts %s, %s', (address) => {
    expect(isLocalAddress(address)).toBe(true);
  });

  it.each([
    ['127.0.0.2', 'another loopback address, which the resolver rule does not let a host reach'],
    ['[::ffff:7f00:1]', 'IPv4 mapped in IPv6, which the resolver rule refuses'],
    ['[0:0:0:0:0:0:0:1]', 'a longer spelling of ::1, which Playwright does not write'],
    ['::1', 'the IPv6 loopback address without brackets, which Playwright does not write'],
    ['0.0.0.0', 'the address of every interface'],
    ['192.168.1.10', 'an address of the local network'],
    ['169.254.169.254', 'the metadata address of a cloud machine'],
    ['localhost', 'a name, not an address'],
    [' 127.0.0.1', 'the address with a space'],
    ['', 'no address'],
  ])('refuses %s, %s', (address) => {
    expect(isLocalAddress(address)).toBe(false);
  });
});
