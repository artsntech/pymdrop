# Extension Setup Guide

## Build

```bash
cd extension
npm install
npm run build         # For Chrome (generates dist/)
npm run build:firefox # For Firefox (generates dist-firefox/)
```

### Install in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right switch).
3. Click **Load unpacked** and select the `dist/` folder.
4. Open the popup, click **Advanced Settings**, and paste your Server URL.

### Install in Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `dist-firefox/manifest.json`.
3. Configure the Server URL in the popup.

> ⚠️ **Note:** Temporarily loaded extensions disappear when Firefox closes.

---

## Development

* `npm run dev`: Starts Vite in watch mode.
* Edit `src/background.ts` to add new tracking domains to `TRACKER_DOMAINS`.
* Edit `src/App.tsx` or `src/Options.tsx` to change the UI.