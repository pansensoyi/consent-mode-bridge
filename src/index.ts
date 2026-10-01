/**
 * consent-mode-bridge — Google Consent Mode v2 helper.
 *
 * Maps any CMP's category choices (OneTrust, Cookiebot, Didomi, a home-grown banner…)
 * to Consent Mode signals and sends them to gtag / Google Tag Manager the right way.
 */

export const CONSENT_TYPES = [
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
  'functionality_storage',
  'personalization_storage',
  'security_storage',
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];
export type ConsentValue = 'granted' | 'denied';
export type ConsentState = Record<ConsentType, ConsentValue>;

/** CMP category name -> Consent Mode types it controls. */
export type CategoryMapping = Record<string, ConsentType[]>;

/** Sensible default mapping using common CMP category names. */
export const DEFAULT_MAPPING: CategoryMapping = {
  necessary: ['security_storage'],
  functional: ['functionality_storage'],
  preferences: ['functionality_storage', 'personalization_storage'],
  analytics: ['analytics_storage'],
  statistics: ['analytics_storage'],
  marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  advertising: ['ad_storage', 'ad_user_data', 'ad_personalization'],
};

/** Everything denied except security storage (strictly necessary). */
export const DENY_ALL: ConsentState = Object.freeze({
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  functionality_storage: 'denied',
  personalization_storage: 'denied',
  security_storage: 'granted',
}) as ConsentState;

export const GRANT_ALL: ConsentState = Object.freeze(
  Object.fromEntries(CONSENT_TYPES.map((t) => [t, 'granted'])),
) as ConsentState;

/**
 * Convert CMP category choices into a full ConsentState.
 * A type is granted if ANY accepted category maps to it; unknown categories are ignored.
 * `security_storage` stays granted unless `strict` is set.
 */
export function mapCategories(
  accepted: Record<string, boolean> | string[],
  mapping: CategoryMapping = DEFAULT_MAPPING,
  { strict = false }: { strict?: boolean } = {},
): ConsentState {
  const acceptedSet = new Set(
    Array.isArray(accepted)
      ? accepted.map((c) => c.toLowerCase())
      : Object.entries(accepted)
          .filter(([, v]) => v)
          .map(([k]) => k.toLowerCase()),
  );
  const state: ConsentState = { ...DENY_ALL };
  if (strict) state.security_storage = 'denied';
  const normalised = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k.toLowerCase(), v]));
  for (const cat of acceptedSet) {
    for (const t of normalised[cat] ?? []) state[t] = 'granted';
  }
  return state;
}

/** Returns only the keys whose value differs between two states. */
export function diffConsent(prev: ConsentState, next: ConsentState): Partial<ConsentState> {
  const out: Partial<ConsentState> = {};
  for (const t of CONSENT_TYPES) if (prev[t] !== next[t]) out[t] = next[t];
  return out;
}

// --------------------------------------------------------------------------- gtag

export interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/**
 * Ensure `window.dataLayer` and `window.gtag` exist.
 * gtag MUST push the `arguments` object (not an array) — GTM only treats
 * Arguments objects as gtag commands, a common bug in hand-rolled snippets.
 */
export function ensureGtag(win: GtagWindow): (...args: unknown[]) => void {
  win.dataLayer = win.dataLayer || [];
  if (typeof win.gtag !== 'function') {
    win.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      (win.dataLayer as unknown[]).push(arguments);
    };
  }
  return win.gtag;
}

export interface DefaultOptions {
  /** ISO 3166-2 region codes this default applies to, e.g. ['ES', 'US-CA']. */
  region?: string[];
  /** Milliseconds to wait for an update before tags fire (typical: 500). */
  waitForUpdate?: number;
  /** Redact ad click identifiers when ad_storage is denied. */
  adsDataRedaction?: boolean;
  /** Pass ad click info through URLs when cookies are denied. */
  urlPassthrough?: boolean;
}

export function setDefaultConsent(win: GtagWindow, state: ConsentState = DENY_ALL, opts: DefaultOptions = {}): void {
  const gtag = ensureGtag(win);
  const payload: Record<string, unknown> = { ...state };
  if (opts.region?.length) payload.region = opts.region;
  if (opts.waitForUpdate != null) payload.wait_for_update = opts.waitForUpdate;
  gtag('consent', 'default', payload);
  if (opts.adsDataRedaction != null) gtag('set', 'ads_data_redaction', opts.adsDataRedaction);
  if (opts.urlPassthrough != null) gtag('set', 'url_passthrough', opts.urlPassthrough);
}

export function updateConsent(win: GtagWindow, state: Partial<ConsentState>): void {
  if (Object.keys(state).length === 0) return;
  ensureGtag(win)('consent', 'update', { ...state });
}

// ------------------------------------------------------------------------- bridge

export interface BridgeOptions extends DefaultOptions {
  mapping?: CategoryMapping;
  defaults?: ConsentState;
  /** dataLayer event pushed after every update so GTM triggers can react. Set to null to disable. */
  eventName?: string | null;
  onChange?: (state: ConsentState, changed: Partial<ConsentState>) => void;
}

export interface ConsentBridge {
  /** Push the default command. Call as early as possible, before GTM/gtag loads. */
  init(): void;
  /** Apply CMP choices. Only changed signals are sent. */
  update(accepted: Record<string, boolean> | string[]): ConsentState;
  grantAll(): ConsentState;
  denyAll(): ConsentState;
  getState(): ConsentState;
}

export function createConsentBridge(win: GtagWindow, options: BridgeOptions = {}): ConsentBridge {
  const { mapping = DEFAULT_MAPPING, defaults = DENY_ALL, eventName = 'consent_update', onChange, ...defaultOpts } = options;
  let state: ConsentState = { ...defaults };
  let initialised = false;

  const apply = (next: ConsentState): ConsentState => {
    if (!initialised) throw new Error('consent-mode-bridge: call init() before update()');
    const changed = diffConsent(state, next);
    state = { ...next };
    if (Object.keys(changed).length) {
      updateConsent(win, changed);
      if (eventName) (win.dataLayer as unknown[]).push({ event: eventName, consent: { ...state } });
      onChange?.({ ...state }, changed);
    }
    return { ...state };
  };

  return {
    init() {
      if (initialised) return;
      setDefaultConsent(win, state, defaultOpts);
      initialised = true;
    },
    update: (accepted) => apply(mapCategories(accepted, mapping)),
    grantAll: () => apply({ ...GRANT_ALL }),
    denyAll: () => apply({ ...DENY_ALL }),
    getState: () => ({ ...state }),
  };
}
