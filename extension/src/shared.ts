export interface ProxySettings {
  gcpUrl: string;
  token: string;
  quality: number;
  grayscale: boolean;
  blockMedia: boolean;
  blockScripts: boolean;
  blockStyles: boolean;
  blockFonts: boolean;
  blockAllImages: boolean;
  blockTrackers: boolean;
  whitelist: string[];
  showFloatingButton: boolean;
  floatingButtonPosition: "right" | "left";
  enabled: boolean;
}

export const DEFAULT_SETTINGS: ProxySettings = {
  gcpUrl: "http://localhost:8080",
  token: "",
  quality: 50,
  grayscale: true,
  blockMedia: false,
  blockScripts: false,
  blockStyles: false,
  blockFonts: false,
  blockAllImages: false,
  blockTrackers: true,
  whitelist: [
    // Known sites that break the proxy. Facebook and 
    // Instagram use IP-signed tokens in image URLs, 
    // which prevents the proxy from downloading them.
    "facebook.com",
    "instagram.com",
  ],
  showFloatingButton: true,
  floatingButtonPosition: "right",
  enabled: true,
};

/** Return the base URL of the server without a trailing (forward) slash, 
 * or null if it is invalid. */
export function normalizeBaseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** Origin + base path, without a trailing slash (e.g., "https://pymdrop.run.app") */
export function baseHref(url: URL): string {
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * Normalizes a domain entered by the user:
	• accepts https://sapo.pt, sapo.pt, www.sapo.pt/path
	• removes scheme, path, query, fragment
	• removes www. for uniformity
	• returns in lowercase
 * Returns null if it is not a valid domain.
 */
export function normalizeDomain(input: string): string | null {
  let raw = input.trim().toLowerCase();
  if (!raw) return null;

  try {
    if (raw.includes("://")) {
      const url = new URL(raw);
      raw = url.hostname;
    } else if (raw.includes("/")) {
      const url = new URL("http://" + raw);
      raw = url.hostname;
    }
  } catch {
    return null;
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) return null;

  raw = raw.replace(/^www\./, "");

  return raw;
}

export async function loadSettings(): Promise<ProxySettings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}