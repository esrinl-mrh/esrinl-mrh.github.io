
// ============================
//  Laadpalen – Zoekgebieden Editor
//  /js/script.js (ArcGIS JS 4.34, ESM)
// ============================

// ArcGIS Maps SDK (ESM imports)
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
 * Accepts source CODE or NAME, returns target CODE when possible.
 * Falls back to original value if mapping is not possible or domains absent.
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

// Collect OIDs from FeatureLayer "edits" event
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

// Collect OIDs from Editor "edits" event (for a specific target layer)
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

