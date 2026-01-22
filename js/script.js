
// ============================
//  Laadpalen – Zoekgebieden Editor
//  /js/script.js  (ArcGIS JS 4.34 ESM)
// ============================

import WebMap from "https://js.arcgis.com/4.34/@arcgis/core/WebMap.js";
import MapView from "https://js.arcgis.com/4.34/@arcgis/core/views/MapView.js";
import Editor from "https://js.arcgis.com/4.34/@arcgis/core/widgets/Editor.js";
import OAuthInfo from "https://js.arcgis.com/4.34/@arcgis/core/identity/OAuthInfo.js";
import IdentityManager from "https://js.arcgis.com/4.34/@arcgis/core/identity/IdentityManager.js";
import Portal from "https://js.arcgis.com/4.34/@arcgis/core/portal/Portal.js";

// -----------------------------------------------------
// Toast helpers
// -----------------------------------------------------
const toastEl  = document.getElementById("toast");
const toastMsg = document.getElementById("toast-msg");
let toastTimer = null;

function showToast(message, type = "info", ms = 3000) {
  if (!toastEl || !toastMsg) return;
  toastEl.className = "toast";
  toastEl.classList.add(`toast--${type}`, "show");
  toastMsg.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// -----------------------------------------------------
// Field & domain helpers
// -----------------------------------------------------
function findFieldName(layer, desiredName) {
  const f = layer.fields?.find(
    (fld) => String(fld.name).toLowerCase() === String(desiredName).toLowerCase()
  );
  return f?.name || desiredName;
}

function getField(layer, fieldName) {
  const actual = findFieldName(layer, fieldName);
  return layer.fields?.find((f) => f.name === actual);
}

/**
 * Translate a value between coded value domains by NAME.
 * Accepts source CODE or NAME; returns target CODE if mapping is found.
 * If no mapping is possible, returns the original value.
 */
function translateDomainValue(value, srcField, tgtField) {
  const srcDom = srcField?.domain?.codedValues;
  const tgtDom = tgtField?.domain?.codedValues;
  if (!srcDom || !tgtDom) return value;

  const srcByCode = srcDom.find((cv) => cv.code === value);
  const srcByName = srcDom.find(
    (cv) => String(cv.name).toLowerCase() === String(value).toLowerCase()
  );
  const srcEntry = srcByCode || srcByName;
  if (!srcEntry) return value;

  const tgtEntry = tgtDom.find(
    (cv) => String(cv.name).toLowerCase() === String(srcEntry.name).toLowerCase()
  );
  return tgtEntry ? tgtEntry.code : value;
}

// -----------------------------------------------------
// OAuth (ArcGIS Online)
// -----------------------------------------------------
const portalUrl = "https://www.arcgis.com";
const oAuthInfo = new OAuthInfo({
  appId: "DDjxKU7PiR0S6kzt",
  portalUrl,
  popup: true,
  popupCallbackUrl: "https://esrinl-mrh.github.io/oauth-callback.html"
});
IdentityManager.registerOAuthInfos([oAuthInfo]);

// UI references
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
    await IdentityManager.getCredential(`${portalUrl}/sharing`);
    updateAuthUI();
    showToast("Ingelogd bij ArcGIS Online.", "success");
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
  window.location.reload();
}

if (loginBtn)  loginBtn.addEventListener("click", signIn);
if (logoutBtn) logoutBtn.addEventListener("click", signOut);

// -----------------------------------------------------
// App lifecycle
// -----------------------------------------------------
let appStarted = false;
let view = null;
let webmap = null;

/**
 * Hook propagation right after Laadpaal.applyEdits completes successfully.
 * Works regardless of which UI triggered the edit (Editor, popup, custom code).
 */
function hookPropagationOnApplyEdits(laadpaalLayer, zoekgebiedLayer) {
  if (laadpaalLayer.__propHookInstalled) return; // avoid double-wrapping

  // Resolve field names & schemas once
  const laadpaalFldName   = findFieldName(laadpaalLayer, "laadpaal_geaccepteerd");
  const zoekgebiedFldName = findFieldName(zoekgebiedLayer, "Laadpaal_geaccepteerd");
  const laadpaalField     = getField(laadpaalLayer, laadpaalFldName);
  const zoekgebiedField   = getField(zoekgebiedLayer, zoekgebiedFldName);

  // Keep original
  const origApplyEdits = laadpaalLayer.applyEdits.bind(laadpaalLayer);

  const propagateFromOids = async (objectIds) => {
    if (!objectIds?.length) return;

    // Fetch edited Laadpaal features (geom + attrs)
    const q = laadpaalLayer.createQuery();
    q.objectIds = objectIds;
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

      // Intersect Zoekgebied
      const zq = zoekgebiedLayer.createQuery();
      zq.geometry = lf.geometry;
      zq.spatialRelationship = "intersects";
      zq.outFields = ["*"];
      zq.returnGeometry = false;

      const zres = await zoekgebiedLayer.queryFeatures(zq);
      if (!zres.features.length) continue;
      hadTargets = true;

      // Build updates
      const updates = zres.features.map((zf) => {
        const uf = zf.clone();
        uf.attributes[zoekgebiedFldName] = tgtVal;
        return uf;
      });

      const res = await zoekgebiedLayer.applyEdits({ updateFeatures: updates });
      const ok  = (res.updateFeatureResults || []).filter((r) => !r.error).length;
      totalUpdated += ok;

      const err = (res.updateFeatureResults || []).find((r) => r.error)?.error;
      if (err) {
        console.error("Zoekgebied update error:", err);
        showToast(
          `Fout bij bijwerken van Zoekgebied: ${err.message || "onbekende fout"}`,
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
  };

  // Wrap Laadpaal.applyEdits
  laadpaalLayer.applyEdits = async (edits) => {
    const res = await origApplyEdits(edits);

    // Collect OIDs from add + update results
    const changedOids = [
      ...((res.addFeatureResults || []).map((r) => r.objectId).filter(Boolean)),
      ...((res.updateFeatureResults || []).map((r) => r.objectId).filter(Boolean)),
    ];
    // Fire & forget propagation
    Promise.resolve()
      .then(() => propagateFromOids([...new Set(changedOids)]))
      .catch((e) => console.error("Propagation error:", e));

    return res;
  };

  laadpaalLayer.__propHookInstalled = true;
  console.debug("Propagation hook installed on Laadpaal.applyEdits");
}

async function startApp({ reinit = false } = {}) {
  if (appStarted && !reinit) return;
  appStarted = true;

  try {
    if (reinit && view) {
      view.destroy();
      view = null;
    }

    const portal = new Portal({ url: portalUrl });
    await portal.load();

    webmap = new WebMap({
      portalItem: {
        id: "5140997c30f3442d83a178b1d08052d4",
        portal
      }
    });

    view = new MapView({
      map: webmap,
      container: "viewDiv"
    });

    await webmap.loadAll();

    // Resolve layers
    const laadpaalLayer =
      webmap.allLayers.find(l => l.type === "feature" && l.title === "Laadpaal") ||
      webmap.allLayers.find(l => l.type === "feature" && l.layerId === 0);

    const zoekgebiedLayer =
      webmap.allLayers.find(l => l.type === "feature" && l.title === "Zoekgebied") ||
      webmap.allLayers.find(l => l.type === "feature" && l.layerId === 1);

    if (!laadpaalLayer) throw new Error("Layer not found: 'Laadpaal' (layerId 0)");
    if (!zoekgebiedLayer) throw new Error("Layer not found: 'Zoekgebied' (layerId 1)");

    await Promise.all([laadpaalLayer.load(), zoekgebiedLayer.load()]);

    // Install propagation hook BEFORE creating the Editor
    hookPropagationOnApplyEdits(laadpaalLayer, zoekgebiedLayer);

    // Popup hardening: Zoekgebied view-only (no Edit actions)
    if (zoekgebiedLayer.popupEnabled !== false) {
      zoekgebiedLayer.popupTemplate = {
        ...(zoekgebiedLayer.popupTemplate || {}),
        actions: []
      };
    }
    zoekgebiedLayer.defaultPopupTemplateEnabled = false;

    // Editor: ONLY Laadpaal editable, Zoekgebied disabled
    const editor = new Editor({
      view,
      allowedWorkflows: ["create", "update"],
      layerInfos: [
        {
          layer: laadpaalLayer,
          enabled: true,
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
          enabled: false,
          addEnabled: false,
          updateEnabled: false,
          deleteEnabled: false
        }
      ]
    });
    view.ui.add(editor, "top-right");

  } catch (err) {
    console.error("WebMap init failed:", err);
    if (String(err).includes("permission") || String(err).includes("403")) {
      showToast("Geen toegang tot webmap of sublaag(‑en). Controleer shares/rollen.", "error", 5000);
    } else if (String(err).toLowerCase().includes("token") || String(err).includes("identity")) {
      showToast("Authenticatie vereist. Probeer opnieuw in te loggen.", "error", 5000);
    } else {
      showToast("Fout bij laden van de webmap. Zie console voor details.", "error", 5000);
    }
  }
}

// -----------------------------------------------------
// Kick off: resolve sign-in state, then start
// -----------------------------------------------------
IdentityManager.checkSignInStatus(`${portalUrl}/sharing`)
  .then(() => showToast("Sessiestatus hersteld.", "info", 1500))
  .catch(() => {}) // not signed in
  .finally(() => {
    updateAuthUI();
    startApp();
  });
