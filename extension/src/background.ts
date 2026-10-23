import {
  DEFAULT_SETTINGS,
  baseHref,
  loadSettings,
  normalizeBaseUrl,
  type ProxySettings,
} from "./shared";

const dnr = chrome.declarativeNetRequest;

const RULE_IMAGES = 1;
const RULE_SCRIPTS = 2;
const RULE_STYLES = 3;
const RULE_FONTS = 4;
const RULE_MEDIA = 5;
const RULE_TRACKERS = 6;

// Extension icons. When `enabled = false`, we use the grayscale version to
// give instant visual feedback to the user
const ICONS_ENABLED = {
  16: "icons/pymdrop-16.png",
  48: "icons/pymdrop-48.png",
  128: "icons/pymdrop-128.png",
};

const ICONS_DISABLED = {
  16: "icons/pymdrop-disabled-16.png",
  48: "icons/pymdrop-disabled-48.png",
  128: "icons/pymdrop-disabled-128.png",
};

// Firefox does not expose the RuleActionType enum at runtime, and Chrome accepts 
// literal strings. The cast convinces TypeScript that the value is valid.
const ACTION_BLOCK = "block" as chrome.declarativeNetRequest.RuleActionType;
const ACTION_REDIRECT = "redirect" as chrome.declarativeNetRequest.RuleActionType;

const IMAGE_REGEX = "^(https?://.+\\.(?:jpe?g|png)(?:\\?.*)?)$";

const TRACKER_DOMAINS: string[] = [
  "google-analytics.com",
  "googletagmanager.com",
  "segment.com",
  "segment.io",
  "mixpanel.com",
  "amplitude.com",
  "heap.io",
  "heapanalytics.com",
  "plausible.io",
  "matomo.cloud",
  "statcounter.com",
  "hotjar.com",
  "hotjar.io",
  "clarity.ms",
  "fullstory.com",
  "mouseflow.com",
  "crazyegg.com",
  "smartlook.com",
  "quantserve.com",
  "quantcast.com",
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "adservice.google.com",
  "adservice.google.pt",
  "adservice.google.com.br",
  "adsafeprotected.com",
  "amazon-adsystem.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "casalemedia.com",
  "adnxs.com",
  "adsrvr.org",
  "sharethrough.com",
  "smartadserver.com",
  "yieldmo.com",
  "media.net",
  "contextweb.com",
  "sovrn.com",
  "lijit.com",
  "teads.tv",
  "spotxchange.com",
  "adform.net",
  "adroll.com",
  "bat.bing.com",
  "sentry.io",
  "sentry-cdn.com",
  "datadoghq.com",
  "newrelic.com",
  "nr-data.net",
  "bugsnag.com",
  "rollbar.com",
  "logrocket.com",
  "logrocket.io",
  "raygun.io",
  "trackjs.com",
  "connect.facebook.net",
  "facebook.com",
  "scorecardresearch.com",
  "addthis.com",
  "addthisedge.com",
  "sharethis.com",
  "platform.twitter.com",
  "syndication.twitter.com",
  "ads.linkedin.com",
  "snap.licdn.com",
  "analytics.tiktok.com",
  "business-api.tiktok.com",
  "analytics.yahoo.com",
  "geo.yahoo.com",
  "mc.yandex.ru",
  "mc.yandex.com",
  "vk.com",
  "top-fwz1.mail.ru",
];

function expandWhitelist(whitelist: string[]): string[] {
  const out: string[] = [];
  for (const domain of whitelist) {
    out.push(domain);
    if (!domain.startsWith("*.")) {
      out.push(`*.${domain}`);
    }
  }
  return out;
}

function blockRule(
  id: number,
  resourceType: chrome.declarativeNetRequest.ResourceType,
  excludedInitiators: string[],
): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 1,
    action: { type: ACTION_BLOCK },
    condition: {
      resourceTypes: [resourceType],
      excludedInitiatorDomains: excludedInitiators,
    },
  };
}

function buildRules(settings: ProxySettings): chrome.declarativeNetRequest.Rule[] {
  if (!settings.enabled) return [];

  const excludedInitiators = expandWhitelist(settings.whitelist ?? []);
  const rules: chrome.declarativeNetRequest.Rule[] = [];

  if (settings.blockAllImages) {
    rules.push({
      id: RULE_IMAGES,
      priority: 2,
      action: { type: ACTION_BLOCK },
      condition: {
        regexFilter: IMAGE_REGEX,
        isUrlFilterCaseSensitive: false,
        resourceTypes: [dnr.ResourceType.IMAGE],
        excludedInitiatorDomains: excludedInitiators,
      },
    });
  } else {
    const base = normalizeBaseUrl(settings.gcpUrl);

    if (base) {
      const params = new URLSearchParams({
        quality: String(settings.quality),
        grayscale: settings.grayscale ? "true" : "false",
      });
      if (settings.token) params.set("token", settings.token);

      const redirectTo = `${baseHref(base)}/proxy?${params.toString()}&url=\\1`;

      rules.push({
        id: RULE_IMAGES,
        priority: 1,
        action: {
          type: ACTION_REDIRECT,
          redirect: { regexSubstitution: redirectTo },
        },
        condition: {
          regexFilter: IMAGE_REGEX,
          isUrlFilterCaseSensitive: false,
          resourceTypes: [dnr.ResourceType.IMAGE],
          excludedRequestDomains: [base.hostname],
          excludedInitiatorDomains: excludedInitiators,
        },
      });
    }
  }

  if (settings.blockTrackers) {
    if (TRACKER_DOMAINS.length > 0) {
      rules.push({
        id: RULE_TRACKERS,
        priority: 1,
        action: { type: ACTION_BLOCK },
        condition: {
          requestDomains: TRACKER_DOMAINS,
          excludedInitiatorDomains: excludedInitiators,
        },
      });
    } else {
      console.warn(
        "[PymDrop] blockTrackers is enabled but TRACKER_DOMAINS is empty — rule ignored",
      );
    }
  }

  if (settings.blockScripts)
    rules.push(blockRule(RULE_SCRIPTS, dnr.ResourceType.SCRIPT, excludedInitiators));
  if (settings.blockStyles)
    rules.push(blockRule(RULE_STYLES, dnr.ResourceType.STYLESHEET, excludedInitiators));
  if (settings.blockFonts)
    rules.push(blockRule(RULE_FONTS, dnr.ResourceType.FONT, excludedInitiators));
  if (settings.blockMedia)
    rules.push(blockRule(RULE_MEDIA, dnr.ResourceType.MEDIA, excludedInitiators));

  return rules;
}

async function updateIcon(enabled: boolean): Promise<void> {
  try {
    await chrome.action.setIcon({
      path: enabled ? ICONS_ENABLED : ICONS_DISABLED,
    });
  } catch (error) {
    console.error("[PymDrop] Failed to update icon:", error);
  }
}

async function syncRules(): Promise<void> {
  const settings = await loadSettings();
  const existing = await dnr.getDynamicRules();

  await dnr.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: buildRules(settings),
  });

  await updateIcon(settings.enabled);

  try {
    await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  } catch {
    // Firefox might not support it. Ignore it.
  }
}

// Rule updates are serialized: two concurrent calls to
// updateDynamicRules with the same IDs fail.
let syncChain: Promise<void> = Promise.resolve();

function scheduleSync(): void {
  syncChain = syncChain.then(syncRules).catch((error) => {
    console.error("[PymDrop] Failed to sync rules:", error);
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["settings", "bytesSaved", "totalBytes"]);

  await chrome.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...(current.settings ?? {}) },
    bytesSaved: current.bytesSaved ?? 0,
    totalBytes: current.totalBytes ?? 0,
  });

  scheduleSync();
});

chrome.runtime.onStartup.addListener(async () => {
  // Apply the correct icon even before syncRules — this way 
  // the user sees the real state as soon as the browser starts.
  const settings = await loadSettings();
  await updateIcon(settings.enabled);
  scheduleSync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) scheduleSync();
});

// ---------------------------------------------------------------------------
// Content script messages (floating button)
// ---------------------------------------------------------------------------

interface ToggleWhitelistMessage {
  type: "toggle-whitelist";
  domain: string;
}

interface CheckWhitelistMessage {
  type: "check-whitelist";
  domain: string;
}

type IncomingMessage = ToggleWhitelistMessage | CheckWhitelistMessage;

chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "toggle-whitelist") {
    handleToggleWhitelist(message.domain)
      .then(sendResponse)
      .catch((error) => {
        console.error("[PymDrop] Error toggling whitelist:", error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "check-whitelist") {
    checkWhitelist(message.domain)
      .then(sendResponse)
      .catch((error) => {
        console.error("[PymDrop] Error checking whitelist:", error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }

  return false;
});

async function checkWhitelist(domain: string): Promise<{ inWhitelist: boolean }> {
  const settings = await loadSettings();
  return { inWhitelist: settings.whitelist.includes(domain) };
}

async function handleToggleWhitelist(
  domain: string,
): Promise<{ success: boolean; inWhitelist: boolean }> {
  const settings = await loadSettings();
  const set = new Set(settings.whitelist);

  if (set.has(domain)) {
    set.delete(domain);
  } else {
    set.add(domain);
  }

  const updated: ProxySettings = { ...settings, whitelist: Array.from(set) };
  await chrome.storage.local.set({ settings: updated });

  return { success: true, inWhitelist: set.has(domain) };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface ProxyResponseSnapshot {
  url: string;
  statusCode: number;
  fromCache: boolean;
  original?: string;
  compressed?: string;
  fallback?: string;
}

let statsChain: Promise<void> = Promise.resolve();

function addStats(saved: number, compressed: number): void {
  statsChain = statsChain
    .then(async () => {
      const current = await chrome.storage.local.get(["bytesSaved", "totalBytes"]);

      await chrome.storage.local.set({
        bytesSaved: (current.bytesSaved ?? 0) + saved,
        totalBytes: (current.totalBytes ?? 0) + compressed,
      });
    })
    .catch((error) => console.error("[PymDrop] Failed to save stats:", error));
}

async function recordProxyResponse(snapshot: ProxyResponseSnapshot): Promise<void> {
  const settings = await loadSettings();
  const base = normalizeBaseUrl(settings.gcpUrl);

  if (!base || !snapshot.url.startsWith(`${baseHref(base)}/proxy`)) return;

  // Fallbacks don't count: there was no gain.
  if (snapshot.fallback) return;
  if (snapshot.statusCode !== 200 || snapshot.fromCache) return;

  const original = Number(snapshot.original);
  const compressed = Number(snapshot.compressed);

  if (!Number.isFinite(original) || !Number.isFinite(compressed)) return;
  if (original <= 0 || compressed <= 0) return;
  if (compressed >= original) return;

  addStats(original - compressed, compressed);
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headerValue = (name: string): string | undefined =>
      details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === name.toLowerCase(),
      )?.value;

    const snapshot: ProxyResponseSnapshot = {
      url: details.url,
      statusCode: details.statusCode,
      fromCache: (details as { fromCache?: boolean }).fromCache === true,
      original: headerValue("x-original-size"),
      compressed: headerValue("x-compressed-size"),
      fallback: headerValue("x-pymdrop-fallback"),
    };

    void recordProxyResponse(snapshot);
  },
  { urls: ["<all_urls>"], types: ["image"] },
  ["responseHeaders"],
);