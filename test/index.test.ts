import { describe, expect, it, vi } from 'vitest';
import {
  DENY_ALL,
  GRANT_ALL,
  createConsentBridge,
  diffConsent,
  ensureGtag,
  mapCategories,
  setDefaultConsent,
  type GtagWindow,
} from '../src/index';

/** Convert pushed Arguments objects into plain arrays for assertions. */
const commands = (win: GtagWindow) =>
  (win.dataLayer ?? []).map((e) => (Object.prototype.toString.call(e) === '[object Arguments]' ? Array.from(e as ArrayLike<unknown>) : e));

describe('mapCategories', () => {
  it('denies everything but security by default', () => {
    expect(mapCategories({})).toEqual(DENY_ALL);
  });

  it('grants mapped types for accepted categories (case-insensitive, arrays or records)', () => {
    const s = mapCategories({ Analytics: true, marketing: false });
    expect(s.analytics_storage).toBe('granted');
    expect(s.ad_storage).toBe('denied');
    expect(mapCategories(['marketing']).ad_user_data).toBe('granted');
  });

  it('supports custom mappings and strict mode', () => {
    const s = mapCategories(['C0004'], { C0004: ['ad_storage'] }, { strict: true });
    expect(s.ad_storage).toBe('granted');
    expect(s.security_storage).toBe('denied');
  });
});

describe('gtag helpers', () => {
  it('ensureGtag pushes Arguments objects, not arrays', () => {
    const win: GtagWindow = {};
    ensureGtag(win)('js', 'x');
    expect(Object.prototype.toString.call(win.dataLayer![0])).toBe('[object Arguments]');
  });

  it('does not overwrite an existing gtag', () => {
    const existing = vi.fn();
    const win: GtagWindow = { gtag: existing, dataLayer: [] };
    expect(ensureGtag(win)).toBe(existing);
  });

  it('setDefaultConsent includes region, wait_for_update and set commands', () => {
    const win: GtagWindow = {};
    setDefaultConsent(win, DENY_ALL, { region: ['DE'], waitForUpdate: 500, adsDataRedaction: true, urlPassthrough: true });
    expect(commands(win)).toEqual([
      ['consent', 'default', { ...DENY_ALL, region: ['DE'], wait_for_update: 500 }],
      ['set', 'ads_data_redaction', true],
      ['set', 'url_passthrough', true],
    ]);
  });

  it('diffConsent returns only changed keys', () => {
    expect(diffConsent(DENY_ALL, { ...DENY_ALL, analytics_storage: 'granted' })).toEqual({ analytics_storage: 'granted' });
  });
});

describe('createConsentBridge', () => {
  it('requires init before update', () => {
    expect(() => createConsentBridge({}).update(['analytics'])).toThrow(/init/);
  });

  it('sends only changed signals plus a GTM event, and skips no-op updates', () => {
    const win: GtagWindow = {};
    const onChange = vi.fn();
    const bridge = createConsentBridge(win, { onChange });
    bridge.init();
    bridge.update({ analytics: true });
    bridge.update({ analytics: true }); // no change -> nothing pushed
    const cmds = commands(win);
    expect(cmds).toHaveLength(3);
    expect(cmds[1]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(cmds[2]).toMatchObject({ event: 'consent_update', consent: { analytics_storage: 'granted' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('grantAll / denyAll and getState', () => {
    const win: GtagWindow = {};
    const bridge = createConsentBridge(win, { eventName: null });
    bridge.init();
    expect(bridge.grantAll()).toEqual(GRANT_ALL);
    expect(bridge.denyAll()).toEqual(DENY_ALL);
    expect(bridge.getState()).toEqual(DENY_ALL);
    expect(commands(win).some((c) => (c as { event?: string }).event)).toBe(false);
  });
});
