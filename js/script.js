
// ArcGIS Maps SDK for JavaScript 4.34 (ESM imports)
import WebMap from "https://js.arcgis.com/4.34/@arcgis/core/WebMap.js";
import MapView from "https://js.arcgis.com/4.34/@arcgis/core/views/MapView.js";
import Editor from "https://js.arcgis.com/4.34/@arcgis/core/widgets/Editor.js";
import OAuthInfo from "https://js.arcgis.com/4.34/@arcgis/core/identity/OAuthInfo.js";
import IdentityManager from "https://js.arcgis.com/4.34/@arcgis/core/identity/IdentityManager.js";

// ---------- OAuth 2.0 (ArcGIS Online) ----------
const portalUrl = "https://www.arcgis.com";
const oAuthInfo = new OAuthInfo({
  // Your ArcGIS Online registered application
  appId: "DDjxKU7PiR0S6kzt",
  portalUrl,
  popup: true,
  // Recommended for popup mode on static hosts (GitHub Pages):
  // Provide a lightweight callback page and add it as a Redirect URI.
  // See 'oauth-callback.html' at the end of this reply.
  popupCallbackUrl: `${window.location.origin}/oauth-callback.html`
});
IdentityManager.registerOAuthInfos([oAuthInfo]);

// UI elements
const loginBtn  = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl  = document.getElementById("status");

// Toast helpers
const toastEl   = document.getElementById("toast");
const toastMsg  = document.getElementById("toast-msg");
let toastTimer;

function showToast(message, type = "info", ms = 3000) {
  // Reset classes
  toastEl.className = "toast";
  toastEl.classList.add(`toast--${type}`, "show");
  toastMsg.textContent = message;

  // Clear existing timers
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, ms);
}

function updateAuthUI() {
  const authed = IdentityManager.credentials?.length > 0;
  loginBtn.style.display = authed ? "none" : "inline-block";
  logoutBtn.style.display = authed ? "inline-block" : "none";
  statusEl.textContent = authed ? "Signed in" : "Not signed in";
}

async function signIn() {
  try {
    await IdentityManager.getCredential(`${portalUrl}/sharing`);
    updateAuthUI();
    showToast("Ingelogd bij ArcGIS Online.", "success");
  } catch (e) {
    console.error("Sign-in canceled or failed", e);
    showToast("Inloggen geannuleerd of mislukt.", "error");
  }
}
function signOut() {
  IdentityManager.destroyCredentials();
  updateAuthUI();
  showToast("Uitgelogd.", "info", 2000);
  // Optional: refresh the app state
  window.location.reload();
}

// Wire UI events
loginBtn.addEventListener("click", signIn);
logoutBtn.addEventListener("click", signOut);

// Reflect existing session, if any
IdentityManager.checkSignInStatus(`${portalUrl}/sharing`)
  .then(() => showToast("Sessiestatus hersteld.", "info", 1500))
  .catch(() => {})  // not signed in, ignore
  .finally(updateAuthUI);

// ---------- WebMap + View ----------
const webmap = new WebMap({
  portalItem: { id: "5140997c30f3442d83a178b1d08052d4" }
});

const view = new MapView({
  map: webmap,
  container: "viewDiv"
});

// Helper to find the two layers, robust to title or service layerId
async function getLayers() {
  await webmap.loadAll();

  const laadpaalLayer =
    webmap.allLayers.find(l => l.type === "feature" && l.title === "Laadpaal")
    || webmap.allLayers.find(l => l.type === "feature" && l.layerId === 0);

  const zoekgebiedLayer =
    webmap.allLayers.find(l => l.type === "feature" && l.title === "Zoekgebied")
    || webmap.allLayers.find(l => l.type === "feature" && l.layerId === 1);

  if (!laadpaalLayer) throw new Error("Layer not found: 'Laadpaal' (layerId 0)");
  if (!zoekgebiedLayer) throw new Error("Layer not found: 'Zoekgebied' (layerId 1)");

  await Promise.all([laadpaalLayer.load(), zoekgebiedLayer.load()]);
  return { laadpaalLayer, zoekgebiedLayer };
}

// ---------- Initialize Editor ----------
let layers;
view.when(async () => {
  try {
    layers = await getLayers();

    const editor = new Editor({
      view,
      allowedWorkflows: ["create", "update"],
      layerInfos: [{
        layer: layers.laadpaalLayer,
        addEnabled: true,
        updateEnabled: true,
        deleteEnabled: false,
        formTemplate: {
          elements: [
            {
              type: "field",
              fieldName: "laadpaal_geaccepteerd",
              label: "Laadpaal geaccepteerd"
              // Coded value domain on the service renders dropdown automatically.
            }
          ]
        }
      }]
    });

    view.ui.add(editor, "top-right");

    // Cross-layer sync: Laadpaal -> Zoekgebied
    wireCrossLayerUpdate(layers.laadpaalLayer, layers.zoekgebiedLayer);
  } catch (err) {
    console.error(err);
    showToast("Fout bij laden van lagen of editor.", "error", 4000);
  }
});

// ---------- Cross-layer update logic ----------
function wireCrossLayerUpdate(laadpaalLayer, zoekgebiedLayer) {
  // Fires after applyEdits completes on this layer (adds/updates/deletes)
  laadpaalLayer.on("edits", async (evt) => {
    try {
      const addIds     = (evt.edits?.addFeatureResults ?? []).map(r => r.objectId).filter(Boolean);
      const updateIds  = (evt.edits?.updateFeatureResults ?? []).map(r => r.objectId).filter(Boolean);
      const changedIds = [...new Set([...addIds, ...updateIds])];
      if (!changedIds.length) return;

      // Fetch changed Laadpaal features
      const q = laadpaalLayer.createQuery();
      q.objectIds = changedIds;
      q.outFields = ["*"];
      q.returnGeometry = true;
      const { features } = await laadpaalLayer.queryFeatures(q);

      let totalUpdated = 0;
      let hadTargets = false;

      for (const f of features) {
        const newVal = f.attributes?.["laadpaal_geaccepteerd"];
        if (newVal === undefined || newVal === null) continue;

        // Find intersecting Zoekgebied features
        const zq = zoekgebiedLayer.createQuery();
        zq.geometry = f.geometry;
        zq.spatialRelationship = "intersects";
        zq.outFields = ["*"];
        zq.returnGeometry = false;
        const zres = await zoekgebiedLayer.queryFeatures(zq);

        if (zres.features.length) hadTargets = true;

