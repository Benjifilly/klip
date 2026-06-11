import { describe, it, expect } from 'vitest';
import { parseJoinLink } from '../src/lib/deeplink';

describe('parseJoinLink', () => {
  it('parses the desktop QR payload (code + relay)', () => {
    expect(parseJoinLink('klip://join?code=kx3m-9p2w-7qrt-c4vn&relay=wss%3A%2F%2Fklip-relay.fly.dev')).toEqual({
      code: 'kx3m-9p2w-7qrt-c4vn',
      relay: 'wss://klip-relay.fly.dev',
    });
    expect(parseJoinLink('klip://join?code=kx3m9p2w7qrtc4vn')).toEqual({
      code: 'kx3m-9p2w-7qrt-c4vn',
      relay: null,
    });
  });

  it('rejects junk, foreign schemes and weak codes', () => {
    expect(parseJoinLink('https://evil.example/join?code=kx3m-9p2w-7qrt-c4vn')).toBeNull();
    expect(parseJoinLink('klip://join?code=benjamin')).toBeNull();
    expect(parseJoinLink('klip://rotate?code=kx3m-9p2w-7qrt-c4vn')).toBeNull();
    expect(parseJoinLink('')).toBeNull();
    expect(parseJoinLink('not a url at all')).toBeNull();
  });

  it('drops a relay that fails the wss/LAN rule instead of rejecting the link', () => {
    expect(parseJoinLink('klip://join?code=kx3m-9p2w-7qrt-c4vn&relay=http://x')).toEqual({
      code: 'kx3m-9p2w-7qrt-c4vn',
      relay: null,
    });
    expect(parseJoinLink('klip://join?code=kx3m-9p2w-7qrt-c4vn&relay=ws://evil.example.com')).toEqual({
      code: 'kx3m-9p2w-7qrt-c4vn',
      relay: null,
    });
    expect(parseJoinLink('klip://join?code=kx3m-9p2w-7qrt-c4vn&relay=ws://192.168.1.10:8787')).toEqual({
      code: 'kx3m-9p2w-7qrt-c4vn',
      relay: 'ws://192.168.1.10:8787',
    });
  });
});
