
// ============================
//  Laadpalen – Zoekgebieden Editor
//  /js/script.js  (ArcGIS JS 4.34 ESM)
// ============================
import * as reactiveUtils from "https://js.arcgis.com/4.34/@arcgis/core/core/reactiveUtils.js";
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



// ---- Toast helper (stacking) ----
function showToast(message, type = "info", timeout = 3000) {
  const container = document.getElementById("toast-container");
  if (!container) {
    // Optional: fallback to console if container missing
    console.warn("toast-container not found; message:", message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger CSS transition
  void toast.offsetWidth;
  toast.classList.add("show");

  // Auto-hide with fade-out
  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 300);
  }, timeout);
}

// Optional: expose for console testing (ESM scope is module-scoped by default)
window.showToast = showToast;


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

function wireEditorPropagationFallback(editor, laadpaalLayer, zoekgebiedLayer) {
    const laadpaalFldName   = findFieldName(laadpaalLayer, "laadpaal_geaccepteerd");
    const zoekgebiedFldName = findFieldName(zoekgebiedLayer, "Laadpaal_geaccepteerd");
    const laadpaalField     = getField(laadpaalLayer, laadpaalFldName);
    const zoekgebiedField   = getField(zoekgebiedLayer, zoekgebiedFldName);
  
    editor.on("edits", async (evt) => {
      try {
        // Collect OIDs the Editor says it updated on Laadpaal
        const ids = [];
        (evt?.edits || []).forEach(edit => {
          if (edit.layer !== laadpaalLayer) return;
          const res = edit.results || edit.result || {};
          (res.addFeatureResults || []).forEach(r => { if (r.objectId != null) ids.push(r.objectId); });
          (res.updateFeatureResults || []).forEach(r => { if (r.objectId != null) ids.push(r.objectId); });
        });
        const changedOids = [...new Set(ids)];
        if (!changedOids.length) return;
  
        // Fetch changed features
        const q = laadpaalLayer.createQuery();
        q.objectIds = changedOids;
        q.outFields = ["*"];
        q.returnGeometry = true;
        const { features } = await laadpaalLayer.queryFeatures(q);
        if (!features.length) return;
  
        // Propagate (simplified, same logic as the main hook)
        let totalUpdated = 0;
        for (const lf of features) {
          const srcVal = lf.attributes?.[laadpaalFldName];
          if (srcVal === undefined || srcVal === null) continue;
  
          const tgtVal = translateDomainValue(srcVal, laadpaalField, zoekgebiedField);
  
          const zq = zoekgebiedLayer.createQuery();
          zq.geometry = lf.geometry;
          zq.spatialRelationship = "intersects";
          zq.outFields = ["*"];
          zq.returnGeometry = false;
          const zres = await zoekgebiedLayer.queryFeatures(zq);
          if (!zres.features.length) continue;
  
          const updates = zres.features.map(zf => {
            const uf = zf.clone();
            uf.attributes[zoekgebiedFldName] = tgtVal;
            return uf;
          });
          const res = await zoekgebiedLayer.applyEdits({ updateFeatures: updates });
          totalUpdated += (res.updateFeatureResults || []).filter(r => !r.error).length;
        }
        if (totalUpdated > 0) {
          showToast(`Zoekgebied bijgewerkt: ${totalUpdated} feature(s).`, "success");
        }
      } catch (e) {
        console.error("Editor fallback propagation error:", e);
        showToast("Fout bij bijwerken van Zoekgebied (fallback).", "error", 4500);
      }
    });
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

/**
 * Hook propagation right after Laadpaal.applyEdits completes successfully.
 * More robust: derives changed features from both the edits param and the result,
 * and falls back to GlobalID when ObjectID isn't returned.
 */
function hookPropagationOnApplyEdits(laadpaalLayer, zoekgebiedLayer) {
  if (laadpaalLayer.__propHookInstalled) return; // avoid double-wrap

  // Resolve field names & schemas once
  const laadpaalFldName   = findFieldName(laadpaalLayer, "laadpaal_geaccepteerd");
  const zoekgebiedFldName = findFieldName(zoekgebiedLayer, "Laadpaal_geaccepteerd");
  const laadpaalField     = getField(laadpaalLayer, laadpaalFldName);
  const zoekgebiedField   = getField(zoekgebiedLayer, zoekgebiedFldName);

  const objectIdField  = laadpaalLayer.objectIdField || "OBJECTID";
  const globalIdField  = laadpaalLayer.globalIdField || "GlobalID";

  // Keep original
  const origApplyEdits = laadpaalLayer.applyEdits.bind(laadpaalLayer);

  // Extract OIDs/GUIDs from the 'edits' argument (before sending to server)
  function collectIdsFromEdits(edits) {
    const oids = new Set();
    const gids = new Set();

    const grab = (features = []) => {
      features.forEach(f => {
        const attrs = f?.attributes || {};
        if (attrs[objectIdField] != null) oids.add(attrs[objectIdField]);
        if (attrs[globalIdField]) gids.add(attrs[globalIdField]);
      });
    };
    if (edits?.addFeatures) grab(edits.addFeatures);
    if (edits?.updateFeatures) grab(edits.updateFeatures);
    // deletes are irrelevant for propagation
    return { oids: [...oids], gids: [...gids] };
  }

  // Extract OIDs from the server result
  function collectOidsFromResult(res) {
    const ids = [];
    (res?.addFeatureResults || []).forEach(r => { if (r.objectId != null) ids.push(r.objectId); });
    (res?.updateFeatureResults || []).forEach(r => { if (r.objectId != null) ids.push(r.objectId); });
    return [...new Set(ids)];
  }

  // Query Laadpaal by OIDs OR (if needed) by GlobalIDs
  async function fetchChangedLaadpaal(oids, gids) {
    // Try OIDs first
    if (oids?.length) {
      const q = laadpaalLayer.createQuery();
      q.objectIds = oids;
      q.outFields = ["*"];
      q.returnGeometry = true;
      const r = await laadpaalLayer.queryFeatures(q);
      if (r.features?.length) return r.features;
    }
    // Fallback by GlobalIDs
    if (gids?.length && globalIdField) {
      const esc = gids.map(g => `'${g}'`).join(",");
      const where = `${globalIdField} IN (${esc})`;
      const q = laadpaalLayer.createQuery();
      q.where = where;
      q.outFields = ["*"];
      q.returnGeometry = true;
      const r = await laadpaalLayer.queryFeatures(q);
      return r.features || [];
    }
    return [];
  }

  
  

  async function propagateFromLaadpaalFeatures(lFeatures) {
    let totalUpdated = 0;
    let hadTargets = false;

    for (const lf of lFeatures) {
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
      const updates = zres.features.map(zf => {
        const uf = zf.clone();
        uf.attributes[zoekgebiedFldName] = tgtVal;
        return uf;
      });

      const res = await zoekgebiedLayer.applyEdits({ updateFeatures: updates });
      const ok  = (res.updateFeatureResults || []).filter(r => !r.error).length;
      totalUpdated += ok;

      const err = (res.updateFeatureResults || []).find(r => r.error)?.error;
      if (err) {
        console.error("Zoekgebied update error:", err);
        showToast(`Fout bij bijwerken van Zoekgebied: ${err.message || "onbekende fout"}`, "error", 4500);
      }
    }

    if (totalUpdated > 0) {
      showToast(`Zoekgebied bijgewerkt: ${totalUpdated} feature(s).`, "success");
    } else if (!hadTargets) {
      // Don’t spam if user edited attributes that don’t change geometry, but still useful:
      showToast("Geen overlappende Zoekgebied‑features gevonden.", "info", 2500);
    }
  }

  // Wrap applyEdits to always propagate
  laadpaalLayer.applyEdits = async (edits) => {
    // Snapshot intended targets BEFORE the call
    const { oids: preOids, gids: preGids } = collectIdsFromEdits(edits);

    const res = await origApplyEdits(edits);

    // Prefer OIDs from the result, then fall back to the pre-call OIDs/GIDs
    const postOids = collectOidsFromResult(res);
    const changedOids = postOids.length ? postOids : preOids;

    Promise.resolve()
      .then(async () => {
        const features = await fetchChangedLaadpaal(changedOids, preGids);
        if (!features.length) {
          console.debug("Propagation: no Laadpaal features resolved from edit; OIDs:", changedOids, "GIDs:", preGids);
          return;
        }
        await propagateFromLaadpaalFeatures(features);
      })
      .catch(e => console.error("Propagation error:", e));

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
    editor.visible = true;
    
    // Wait for the View, the LayerView, and the Editor to be fully ready and idle,
    // then enter "select by point" on the Laadpaal layer.
    (async () => {
      try {
        // 1) Wait for view ready and not updating
        await reactiveUtils.whenOnce(() => view.ready === true);
        await reactiveUtils.whenOnce(() => view.updating === false);
    
        // 2) Wait for the Laadpaal LayerView and let it finish updating
        const laadpaalLV = await view.whenLayerView(laadpaalLayer);
        if (laadpaalLV) {
          await reactiveUtils.whenOnce(() => laadpaalLV.updating === false);
        }
    
        // 3) Wait for the Editor itself
        await editor.when();
    
        // 4) Make sure no existing workflow is active, then start selection
        if (editor.activeWorkflow) editor.cancelWorkflow();
    
        // Use a microtask to avoid colliding with any internal Editor refresh
        await Promise.resolve();
    
        editor.viewModel.startUpdateWorkflowAtFeatureSelection({
          layer: laadpaalLayer // limits selection to Laadpaal; click=point selection
        });
      } catch (e) {
        console.error("Failed to start selection workflow:", e);
        // Optional: toast if you have showToast available
        if (window.showToast) showToast("Kon selectie-modus niet starten.", "error", 3000);
      }
    })();

    wireEditorPropagationFallback(editor, laadpaalLayer, zoekgebiedLayer);



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
