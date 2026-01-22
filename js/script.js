
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


// ---- Field & domain helpers ----
function findFieldName(layer, desiredName) {
  // Find actual field name by case-insensitive match; fallback to desiredName
  const f = layer.fields?.find(
    (fld) => fld.name?.toLowerCase() === desiredName.toLowerCase()
  );
  return f?.name || desiredName;
}

function getField(layer, fieldName) {
  const actual = findFieldName(layer, fieldName);
  return layer.fields?.find((f) => f.name === actual);
}

/**
 * Translate a value from source field's domain to target field's domain.
 * If domains match or no domains, returns the original value.
 * Strategy:
 *  - If value matches a source domain CODE, find its NAME, then find target CODE by NAME (case-insensitive).
 *  - If value matches a source domain NAME, map to target CODE by NAME (case-insensitive).
 */
function translateDomainValue(value, srcField, tgtField) {
  const srcDom = srcField?.domain?.codedValues;
  const tgtDom = tgtField?.domain?.codedValues;
  if (!srcDom || !tgtDom) return value;

  const v = value;
  // Find a source entry by code OR name
  let srcEntry =
    srcDom.find((cv) => cv.code === v) ||
    srcDom.find((cv) => String(cv.name).toLowerCase() === String(v).toLowerCase());
  if (!srcEntry) return value;

  // In the target domain, match by NAME
  const tgtEntry = tgtDom.find(
    (cv) => String(cv.name).toLowerCase() === String(srcEntry.name).toLowerCase()
  );
  // If found, return the target CODE; else keep original
  return tgtEntry ? tgtEntry.code : value;
}


// ---------- OID collectors from different events ----------
function collectOidsFromLayerEditsEvent(evt) {
  const ids = [];
  const e = evt?.edits ?? {};
  for (const key of ["addFeatureResults", "updateFeatureResults"]) {
    (e[key] || []).forEach((r) => {
      if (r?.objectId != null) ids.push(r.objectId);
    });
  }
  return [...new Set(ids)];
}

function collectOidsFromEditorEditsEvent(evt, targetLayer) {
  const ids = [];
  (evt?.edits || []).forEach((edit) => {
    if (edit?.layer !== targetLayer) return;
    const res = edit.results || edit.result || {};
    for (const key of ["addFeatureResults", "updateFeatureResults"]) {
      (res[key] || []).forEach((r) => {
        if (r?.objectId != null) ids.push(r.objectId);
      });
    }
  });
  return [...new Set(ids)];
}


// ---- Safe/bypass applyEdits for Zoekgebied ----
// Capture original applyEdits early so later "blockers" don't affect internal updates
/*
function getZoekgebiedApplyEdits(zoekgebiedLayer) {
  if (!zoekgebiedLayer.__origApplyEdits) {
    zoekgebiedLayer.__origApplyEdits = zoekgebiedLayer.applyEdits.bind(zoekgebiedLayer);
  }
  return async (edits) => {
    // If someone installed a blocking override later, call the original directly.
    return zoekgebiedLayer.__origApplyEdits(edits);
  };
}
*/

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


function wireCrossLayerUpdate(laadpaalLayer, zoekgebiedLayer, editor) {
  // Resolve actual field names + field schemas
  const laadpaalFldName   = findFieldName(laadpaalLayer, "laadpaal_geaccepteerd");
  const zoekgebiedFldName = findFieldName(zoekgebiedLayer, "Laadpaal_geaccepteerd");
  const laadpaalField     = getField(laadpaalLayer, laadpaalFldName);
  const zoekgebiedField   = getField(zoekgebiedLayer, zoekgebiedFldName);

  async function processChangedLaadpalen(changedOids) {
    if (!changedOids?.length) {
      console.debug("No changed OIDs provided; skipping propagation.");
      return;
    }

    // Fetch changed Laadpaal features
    const q = laadpaalLayer.createQuery();
    q.objectIds = changedOids;
    q.outFields = ["*"];
    q.returnGeometry = true;

    const { features } = await laadpaalLayer.queryFeatures(q);
    if (!features.length) return;

    let totalUpdated = 0;
    let hadTargets   = false;

    for (const lf of features) {
      const srcVal = lf.attributes?.[laadpaalFldName];
      if (srcVal === undefined || srcVal === null) continue;

      const tgtVal = translateDomainValue(srcVal, laadpaalField, zoekgebiedField);

      // Intersections in Zoekgebied
      const zq = zoekgebiedLayer.createQuery();
      zq.geometry = lf.geometry;
      zq.spatialRelationship = "intersects";
      zq.outFields = ["*"];
      zq.returnGeometry = false;

      const zres = await zoekgebiedLayer.queryFeatures(zq);
      if (!zres.features.length) continue;
      hadTargets = true;

      const toUpdate = zres.features.map((zf) => {
        const uf = zf.clone();
        uf.attributes[zoekgebiedFldName] = tgtVal;
        return uf;
      });

      const res = await zoekgebiedLayer.applyEdits({ updateFeatures: toUpdate });
      const ok  = (res.updateFeatureResults || []).filter((r) => !r.error).length;
      totalUpdated += ok;

      const firstErr = (res.updateFeatureResults || []).find((r) => r.error)?.error;
      if (firstErr) {
        console.error("Zoekgebied update error:", firstErr);
        // Domain/permission issues surface here
        showToast(
          `Fout bij bijwerken van Zoekgebied: ${firstErr.message || "onbekende fout"}`,
          "error",
          4500
        );
      }
    }

    if (totalUpdated > 0) {
      showToast(`Zoekgebied bijgewerkt: ${totalUpdated} feature(s).`, "success");
    } else if (!hadTargets) {
      showToast("Geen overlappende Zoekgebied‑features gevonden.", "info", 2500);
    }
  }

  // 1) FeatureLayer "edits" (fires when this client calls applyEdits on that layer)
  laadpaalLayer.on("edits", (evt) => {
    const ids = collectOidsFromLayerEditsEvent(evt);
    console.debug("[Laadpaal] Layer edits event → OIDs:", ids);
    processChangedLaadpalen(ids).catch((e) => console.error("Propagation error:", e));
  });

  // 2) Editor "edits" (fires when the Editor applies edits—covers batch cases)
  editor.on("edits", (evt) => {
    const ids = collectOidsFromEditorEditsEvent(evt, laadpaalLayer);
    if (ids.length) {
      console.debug("[Laadpaal] Editor edits event → OIDs:", ids);
      processChangedLaadpalen(ids).catch((e) => console.error("Propagation error:", e));
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
