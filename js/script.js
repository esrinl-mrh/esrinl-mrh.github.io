
// ArcGIS Maps SDK for JavaScript 4.34 (ESM imports)
import WebMap from "https://js.arcgis.com/4.34/@arcgis/core/WebMap.js";
import MapView from "https://js.arcgis.com/4.34/@arcgis/core/views/MapView.js";
import Editor from "https://js.arcgis.com/4.34/@arcgis/core/widgets/Editor.js";
import OAuthInfo from "https://js.arcgis.com/4.34/@arcgis/core/identity/OAuthInfo.js";
import IdentityManager from "https://js.arcgis.com/4.34/@arcgis/core/identity/IdentityManager.js";
import Portal from "https://js.arcgis.com/4.34/@arcgis/core/portal/Portal.js";

// ---------- Toast helpers ----------
const toastEl  = document.getElementById("toast");
const toastMsg = document.getElementById("toast-msg");
let toastTimer;
function showToast(message, type = "info", ms = 3000) {
  if (!toastEl || !toastMsg) return;
  toastEl.className = "toast";
  toastEl.classList.add(`toast--${type}`, "show");
  toastMsg.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// ---------- OAuth 2.0 (ArcGIS Online) ----------
const portalUrl = "https://www.arcgis.com";
const oAuthInfo = new OAuthInfo({
  appId: "DDjxKU7PiR0S6kzt",
  portalUrl,
  popup: true,
  popupCallbackUrl: "https://esrinl-mrh.github.io/oauth-callback.html"
});
IdentityManager.registerOAuthInfos([oAuthInfo]);

// UI elements
const loginBtn  = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl  = document.getElementById("status");

function updateAuthUI() {
  const authed = IdentityManager.credentials?.length > 0;
  if (loginBtn)  loginBtn.style.display  = authed ? "none" : "inline-block";
  if (logoutBtn) logoutBtn.style.display = authed ? "inline-block" : "none";
  if (statusEl)  statusEl.textContent    = authed ? "Signed in" : "Not signed in";
}

// Start flag & references so we can re-init after login
let appStarted = false;
let view = null;
let webmap = null;

// Centralized initializer – can be called after page load or after login
async function startApp({ reinit = false } = {}) {
  if (appStarted && !reinit) return;
  appStarted = true;

  try {
    // If reinitializing, destroy previous view to avoid orphaned state
    if (reinit && view) {
      view.destroy();
      view = null;
    }

    // Make the portal context explicit (important for secured items)
    const portal = new Portal({ url: portalUrl });
    await portal.load();

    webmap = new WebMap({
      portalItem: {
        id: "5140997c30f3442d83a178b1d08052d4",
        portal // explicit portal so tokens are applied correctly
      }
    });

    view = new MapView({
      map: webmap,
      container: "viewDiv"
    });

    // Wait for the map to fully load (throws on auth/permission issues)
    await webmap.loadAll();

    // Resolve and load target layers
    const laadpaalLayer =
      webmap.allLayers.find(l => l.type === "feature" && l.title === "Laadpaal")
      || webmap.allLayers.find(l => l.type === "feature" && l.layerId === 0);

    const zoekgebiedLayer =
      webmap.allLayers.find(l => l.type === "feature" && l.title === "Zoekgebied")
      || webmap.allLayers.find(l => l.type === "feature" && l.layerId === 1);

    if (!laadpaalLayer) throw new Error("Layer not found: 'Laadpaal' (layerId 0)");
    if (!zoekgebiedLayer) throw new Error("Layer not found: 'Zoekgebied' (layerId 1)");

    await Promise.all([laadpaalLayer.load(), zoekgebiedLayer.load()]);
    
    
    const existingZqTemplate = zoekgebiedLayer.popupTemplate;
    
    zoekgebiedLayer.popupEnabled = true; // view-only allowed
    zoekgebiedLayer.popupTemplate = existingZqTemplate
      ? {
          // keep title/content if present
          title: existingZqTemplate.title,
          content: existingZqTemplate.content,
          expressionInfos: existingZqTemplate.expressionInfos,
          fieldInfos: existingZqTemplate.fieldInfos,
          outFields: existingZqTemplate.outFields,
          // ⛔ remove all actions so "Edit" etc. cannot appear
          actions: []
        }
      : {
          title: "{NAME}",          // adjust if you have a relevant field
          content: "{*}",           // show attributes read-only
          actions: []               // ⛔ no actions at all
        };

// Also ensure default popup actions are not auto-added
zoekgebiedLayer.defaultPopupTemplateEnabled = false;

    
    // Editor

    const editor = new Editor({
      view,
      allowedWorkflows: ["create", "update"],
      layerInfos: [
        {
          layer: laadpaalLayer,
          addEnabled: true,
          updateEnabled: true,
          deleteEnabled: false,
          formTemplate: {
            elements: [
              {
                type: "field",
                fieldName: "laadpaal_geaccepteerd",
                label: "Laadpaal geaccepteerd"
              }
            ]
          }
        },
        {
          layer: zoekgebiedLayer,
          enabled: false
        }
      ],
      // Ensure the Editor does not auto-pull other map layers
      supportingWidgetDefaults: {
        featureForm: { groupDisplay: "sequential" }
      }
    });

    view.ui.add(editor, "top-right");

    // Wire cross-layer updates
    wireCrossLayerUpdate(laadpaalLayer, zoekgebiedLayer);

  } catch (err) {
    console.error("WebMap init failed:", err);
    // Helpful diagnostics for common cases
    if (String(err).includes("permission") || String(err).includes("403")) {
      showToast("Geen toegang tot webmap of sublaag(‑en). Controleer shares/rollen.", "error", 5000);
    } else if (String(err).toLowerCase().includes("token") || String(err).includes("identity")) {
      showToast("Authenticatie vereist. Probeer opnieuw in te loggen.", "error", 5000);
    } else {
      showToast("Fout bij laden van de webmap. Zie console voor details.", "error", 5000);
    }
  }
}

// ---------- Cross-layer update logic ----------
function wireCrossLayerUpdate(laadpaalLayer, zoekgebiedLayer) {
  laadpaalLayer.on("edits", async (evt) => {
    try {
      const addIds     = (evt.edits?.addFeatureResults ?? []).map(r => r.objectId).filter(Boolean);
      const updateIds  = (evt.edits?.updateFeatureResults ?? []).map(r => r.objectId).filter(Boolean);
      const changedIds = [...new Set([...addIds, ...updateIds])];
      if (!changedIds.length) return;

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

        const zq = zoekgebiedLayer.createQuery();
        zq.geometry = f.geometry;
        zq.spatialRelationship = "intersects";
        zq.outFields = ["*"];
        zq.returnGeometry = false;
        const zres = await zoekgebiedLayer.queryFeatures(zq);

        if (zres.features.length) hadTargets = true;

        const toUpdate = zres.features.map(zf => {
          const uf = zf.clone();
          uf.attributes["Laadpaal_geaccepteerd"] = newVal;
          return uf;
        });

        if (toUpdate.length) {
          const res = await zoekgebiedLayer.applyEdits({ updateFeatures: toUpdate });
          const updatedCount = (res.updateFeatureResults || []).filter(r => !r.error).length;
          totalUpdated += updatedCount;
        }
      }

      if (totalUpdated > 0) {
        showToast(`Zoekgebied bijgewerkt: ${totalUpdated} feature(s).`, "success");
      } else if (!hadTargets) {
        showToast("Geen overlappende Zoekgebied‑features gevonden.", "info", 2500);
      }
    } catch (err) {
      console.error("Cross-layer update failed:", err);
      showToast("Fout bij bijwerken van Zoekgebied.", "error", 4000);
    }
  });
}

// ---------- Sign-in flow ----------
async function signIn() {
  try {
    await IdentityManager.getCredential(`${portalUrl}/sharing`);
    updateAuthUI();
    showToast("Ingelogd bij ArcGIS Online.", "success");
    // (Re)start the app after obtaining a credential
    await startApp({ reinit: true });
  } catch (e) {
    console.error("Sign-in canceled or failed", e);
    showToast("Inloggen geannuleerd of mislukt.", "error");
  }
}
function signOut() {
  IdentityManager.destroyCredentials();
  updateAuthUI();
  showToast("Uitgelogd.", "info", 2000);
  // Fresh start on logout
  window.location.reload();
}

// Wire UI events
if (loginBtn)  loginBtn.addEventListener("click", signIn);
if (logoutBtn) logoutBtn.addEventListener("click", signOut);

// 1) Resolve sign-in state first, then start the app
IdentityManager.checkSignInStatus(`${portalUrl}/sharing`)
  .catch(() => {}) // not signed in
  .finally(() => {
    updateAuthUI();
    startApp(); // start once status is known
  });
