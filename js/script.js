
// ArcGIS Maps SDK for JavaScript 4.34 (ESM imports)
import WebMap from "https://js.arcgis.com/4.34/@arcgis/core/WebMap.js";
import MapView from "https://js.arcgis.com/4.34/@arcgis/core/views/MapView.js";
import Editor from "https://js.arcgis.com/4.34/@arcgis/core/widgets/Editor.js";
import OAuthInfo from "https://js.arcgis.com/4.34/@arcgis/core/identity/OAuthInfo.js";
import IdentityManager from "https://js.arcgis.com/4.34/@arcgis/core/identity/IdentityManager.js";

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
  // Fixed for your user site root on GitHub Pages:
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

async function signIn() {
  try {
    // Opens the ArcGIS OAuth popup
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
  // Refresh to clear any in-memory session state
  window.location.reload();
}

// Wire UI events
if (loginBtn)  loginBtn.addEventListener("click", signIn);
if (logoutBtn) logoutBtn.addEventListener("click", signOut);

// Reflect existing session, if any
IdentityManager.checkSignInStatus(`${portalUrl}/sharing`)
  .then(() => showToast("Sessiestatus hersteld.", "info", 1500))
  .catch(() => {})  // not signed in
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
              // The service's coded value domain renders a dropdown automatically.
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

        // Update Zoekgebied.Laadpaal_geaccepteerd = newVal
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
        showToast("Geen overlappende Zoekgebied-features gevonden.", "info", 2500);
      }
    } catch (err) {
      console.error("Cross-layer update failed:", err);
      showToast("Fout bij bijwerken van Zoekgebied.", "error", 4000);
    }
  });
}
