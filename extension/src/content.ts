interface ProxySettings {
  showFloatingButton: boolean;
  floatingButtonPosition: "right" | "left";
  whitelist: string[];
  enabled: boolean;
}

const DEFAULT_SETTINGS: ProxySettings = {
  showFloatingButton: true,
  floatingButtonPosition: "right",
  whitelist: [],
  enabled: true,
};

const BUTTON_ID = "__pymdrop_whitelist_button__";

async function getSettings(): Promise<ProxySettings> {
  const result = await chrome.storage.local.get("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...(result.settings ?? {}),
  };
}

function getCurrentDomain(): string {
  return window.location.hostname.replace(/^www\./, "").toLowerCase();
}

async function sendMessage<T>(message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

async function isDomainWhitelisted(domain: string): Promise<boolean> {
  const res = await sendMessage<{ inWhitelist: boolean }>({
    type: "check-whitelist",
    domain,
  });
  return res?.inWhitelist ?? false;
}

async function toggleWhitelist(domain: string): Promise<boolean> {
  const res = await sendMessage<{ success: boolean; inWhitelist: boolean }>({
    type: "toggle-whitelist",
    domain,
  });
  return res?.inWhitelist ?? false;
}

/**
 * Return the part of `cssText` that positions the button. All variants 
 * use the bottom corners — top positions are rarely useful because they 
 * collide with navigation bars, cookie notices, and banners.
 */
function positionStyles(position: "right" | "left"): string {
  if (position === "left") {
    return "bottom: 16px; left: 16px;";
  }
  return "bottom: 16px; right: 16px;";
}

function buildButtonStyles(position: "right" | "left"): string {
  return [
    "position: fixed",
    positionStyles(position),
    "z-index: 2147483647",
    "padding: 8px 12px",
    "font: 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "border: 1px solid rgba(0,0,0,0.1)",
    "border-radius: 6px",
    "cursor: pointer",
    "box-shadow: 0 2px 8px rgba(0,0,0,0.15)",
    "transition: opacity 0.15s, background 0.15s",
    "opacity: 0.85",
  ].join(";");
}

function applyVisualState(button: HTMLButtonElement, inWhitelist: boolean): void {
  if (inWhitelist) {
    button.textContent = "✓ PymDrop: site allowed";
    button.style.background = "#d1e7dd";
    button.style.color = "#0f5132";
    button.title = "Click to remove this site from the PymDrop whitelist";
  } else {
    button.textContent = "⊘ PymDrop: add to whitelist";
    button.style.background = "#f8d7da";
    button.style.color = "#842029";
    button.title = "Click to allow this site without PymDrop";
  }
}

function renderButton(inWhitelist: boolean, position: "right" | "left"): void {
  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;

  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.style.cssText = buildButtonStyles(position);

    button.addEventListener("mouseenter", () => {
      button!.style.opacity = "1";
    });
    button.addEventListener("mouseleave", () => {
      button!.style.opacity = "0.85";
    });

    button.addEventListener("click", async () => {
      const domain = getCurrentDomain();
      const nowIn = await toggleWhitelist(domain);
      renderButton(nowIn, position);
    });

    document.documentElement.appendChild(button);
  } else {
    // Reapply the styles — the position might have changed in the settings.
    button.style.cssText = buildButtonStyles(position);
  }

  applyVisualState(button, inWhitelist);
}

function removeButton(): void {
  const button = document.getElementById(BUTTON_ID);
  if (button) button.remove();
}

async function init(): Promise<void> {
  const settings = await getSettings();

  // If the extension is turned off or the button is hidden, ensure 
  // that no button is left hanging in the DOM.
  if (!settings.enabled || !settings.showFloatingButton) {
    removeButton();
    return;
  }

  const domain = getCurrentDomain();
  if (!domain) return;

  const inWhitelist = await isDomainWhitelisted(domain);
  renderButton(inWhitelist, settings.floatingButtonPosition);
}

// React to settings changes — if the user toggles the button or 
// changes its position, the content script adjusts in real time without reloading.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    void init();
  }
});

// Only runs in the top document (avoids duplication in iframes).
if (window.top === window) {
  void init();
}

export {};