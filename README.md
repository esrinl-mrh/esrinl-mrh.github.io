

# ArcGIS JS 4.34 OAuth2 Example (Static)

Converted from CodePen: https://codepen.io/esri_marc/pen/GgqEwLX  
This is a **pure static** project (no build tools). It demonstrates using the ArcGIS Maps SDK for JavaScript (4.34) with OAuth 2.0.

## Live
You can host it anywhere that serves static files (GitHub Pages, Netlify, Vercel, S3, etc.).

## Setup

1. **ArcGIS OAuth app**
   - Use the existing `appId` in `js/script.js` or replace with your own.
   - In the ArcGIS developer portal/organization, edit the OAuth app and ensure your site URL is added to **Redirect URIs**. For GitHub Pages:
     ```
     https://<your-username>.github.io/<your-repo>/
     ```
   - If you serve from a subpath, include the exact origin and path.

2. **Portal & WebMap**
   - Update `portalUrl` in `js/script.js` if needed (e.g., `https://www.arcgis.com` or your enterprise portal).
   - Replace the `portalItem.id` with your (possibly secured) WebMap ID.

3. **Run locally**
   Any static server works. Examples:
   ```bash
   # Python 3
   python3 -m http.server 5173

   # Node (if installed)
   npx serve .
