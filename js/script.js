
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
  popup: true // full-page redirect back to the current URL
  // With popup:false, the SDK uses the current page URL as the redirect target.
});
IdentityManager.registerOAuthInfos([oAuthInfo]);

const loginBtn  = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl  = document.getElementById("status");

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
  } catch (e) {
    console.error("Sign-in canceled or failed", e);
  }
}
function signOut() {
  IdentityManager.destroyCredentials();
  updateAuthUI();
  // Reload to clear any in-memory state associated with auth
  window.location.reload();
}

loginBtn.addEventListener("click", signIn);
logoutBtn.addEventListener("click", signOut);
updateAuthUI();

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

  // Try by exact title first, then by service layerId
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
  layers = await getLayers();

  // Editor on top-right, only for Laadpaal layer
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
            // If the field has a coded value domain on the service,
            // the Editor renders a dropdown: "Ja", "Nee", "Nog te beoordelen".
          }
        ]
      }
    }]
  });

  view.ui.add(editor, "top-right");

  // Listen to edits on Laadpaal and propagate to Zoekgebied
  wireCrossLayerUpdate(layers.laadpaalLayer, layers.zoekgebiedLayer);
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

      // Fetch the changed Laadpaal features to read latest attributes + geometry
      const q = laadpaalLayer.createQuery();
      q.objectIds = changedIds;
      q.outFields = ["*"];
      q.returnGeometry = true;
      const { features } = await laadpaalLayer.queryFeatures(q);

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
        if (!zres.features.length) continue;

        // Prepare updates: set Zoekgebied.Laadpaal_geaccepteerd = newVal
        const toUpdate = zres.features.map(zf => {
          const uf = zf.clone();
          uf.attributes["Laadpaal_geaccepteerd"] = newVal;
          return uf;
        });

        if (toUpdate.length) {
          await zoekgebiedLayer.applyEdits({ updateFeatures: toUpdate });
          console.info(`Updated ${toUpdate.length} Zoekgebied feature(s) to '${newVal}'.`);
        }
      }
    } catch (err) {
      console.error("Cross-layer update failed:", err);
    }
  });
}
