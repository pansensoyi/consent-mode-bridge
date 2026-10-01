# consent-mode-bridge

![CI](https://github.com/pansensoyi/consent-mode-bridge/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

Tiny, dependency-free TypeScript helper for **Google Consent Mode v2**. Map any CMP's categories (OneTrust, Cookiebot, Didomi, or your own banner) to the seven consent signals and send them to gtag / Google Tag Manager correctly.

Why it exists — the bugs it prevents:

- **`gtag` pushing arrays instead of `arguments`** — GTM silently ignores array pushes as consent commands.
- **Missing v2 signals** — `ad_user_data` and `ad_personalization` are required for EEA ads measurement.
- **Default set too late** — `init()` is designed to run before the GTM container loads.
- **Noisy updates** — only signals that actually changed are sent, plus one `consent_update` dataLayer event for GTM triggers.

## Install

```bash
npm install github:pansensoyi/consent-mode-bridge
```

## Usage

```ts
import { createConsentBridge } from '@pansensoyi/consent-mode-bridge';

// 1) As early as possible, BEFORE the GTM snippet
const consent = createConsentBridge(window, {
  region: ['DE', 'FR', 'GB'], // optional ISO 3166-2 regions; omit to apply globally
  waitForUpdate: 500,
  adsDataRedaction: true,
});
consent.init(); // pushes: consent default (all denied except security_storage)

// 2) When the user makes a choice in your CMP
consent.update({ necessary: true, analytics: true, marketing: false });
// -> gtag('consent','update',{ analytics_storage:'granted' })
// -> dataLayer.push({ event:'consent_update', consent:{...} })
```

### Custom CMP category IDs (e.g. OneTrust groups)

```ts
const consent = createConsentBridge(window, {
  mapping: {
    C0001: ['security_storage'],
    C0002: ['analytics_storage'],
    C0003: ['functionality_storage', 'personalization_storage'],
    C0004: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  },
});
consent.init();
consent.update(activeGroupsFromCmp); // e.g. ['C0001', 'C0002']
```

### Lower-level helpers

| Function | Purpose |
|---|---|
| `mapCategories(accepted, mapping?)` | CMP choices → full `ConsentState` |
| `setDefaultConsent(win, state, opts)` | `consent default` + `ads_data_redaction` / `url_passthrough` |
| `updateConsent(win, partialState)` | `consent update` |
| `diffConsent(prev, next)` | Changed signals only |
| `ensureGtag(win)` | Safe `dataLayer` / `gtag` bootstrap |

## Development

```bash
npm install
npm test
npm run build
```

> This library helps implement Consent Mode signalling; it is not legal advice and does not replace a CMP.

## License

MIT
