import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startAuthentication, getUserInfo, discardAuthentication, checkAuthentication } from './BamApi';

const STATE_KEY = 'discord-oauth2-state';

function mockLocation() {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '', pathname: '/', search: '', hash: '' },
  });
}

beforeEach(() => {
  localStorage.clear();
  mockLocation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startAuthentication', () => {
  it('stores a CSRF state and redirects to Discord with a matching state', () => {
    startAuthentication();

    const state = localStorage.getItem(STATE_KEY);
    expect(state).toMatch(/^[0-9a-f]{32}$/); // 16 random bytes, hex

    const url = new URL(window.location.href);
    expect(`${url.origin}${url.pathname}`).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('scope')).toBe('identify guilds guilds.members.read');
    // The state sent to Discord must equal the one we stored (CSRF binding).
    expect(url.searchParams.get('state')).toBe(state);
  });

  it('uses a fresh state on each call', () => {
    startAuthentication();
    const first = localStorage.getItem(STATE_KEY);
    startAuthentication();
    expect(localStorage.getItem(STATE_KEY)).not.toBe(first);
  });
});

describe('getUserInfo', () => {
  it('returns the parsed body and sends credentials (the session cookie)', async () => {
    const body = { user: { id: '1', username: 'x' }, member_of: {} };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getUserInfo()).resolves.toEqual(body);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/auth');
    expect(opts.credentials).toBe('include');
  });

  it('throws the server-provided message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Geen Cool Persoon' }) }));
    await expect(getUserInfo()).rejects.toThrow('Geen Cool Persoon');
  });
});

describe('checkAuthentication', () => {
  it('is true when the server accepts the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: {}, member_of: {} }) }));
    await expect(checkAuthentication()).resolves.toBe(true);
  });

  it('is false when the server rejects the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'nope' }) }));
    await expect(checkAuthentication()).resolves.toBe(false);
  });
});

describe('discardAuthentication', () => {
  it('DELETEs the session with credentials and clears local state', async () => {
    localStorage.setItem(STATE_KEY, 'abc');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await discardAuthentication();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/session');
    expect(opts.method).toBe('DELETE');
    expect(opts.credentials).toBe('include');
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
  });

  it('ignores network errors (best-effort logout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(discardAuthentication()).resolves.toBeUndefined();
  });
});
