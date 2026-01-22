
/* ArcGIS JS 4.34 OAuth2 Example (static)
   Notes:
   - Keep your appId and portalUrl in sync with your ArcGIS OAuth app.
   - Ensure your GitHub Pages URL is registered as a Redirect URI in the app.
*/

require([
  "esri/identity/OAuthInfo",
  "esri/identity/IdentityManager",
  "esri/WebMap",
  "esri/views/MapView",
  "esri/portal/Portal"
], function (OAuthInfo, esriId, WebMap, MapView, Portal) {

  // 1) Configure OAuth
  const info = new OAuthInfo({
    appId: "DDjxKU7PiR0S6kzt",                         // <-- replace if needed
    portalUrl: "https://esrinederland.maps.arcgis.com", // <-- replace (e.g. https://www.arcgis.com)
    popup: true   // use popup for sign-in
  });

  esriId.registerOAuthInfos([info]);

  // 2) Check existing sign-in (optional but common)
  esriId.checkSignInStatus(info.portalUrl + "/sharing")
    .then(function () {
      console.log("User already signed in");
      initApp();
    })
    .catch(function () {
      console.log("User not signed in yet, will prompt on first secure request");
      initApp();
    });

  async function initApp() {
    try {
      // 3) Create webmap + view
      const webmap = new WebMap({
        portalItem: { id: "5140997c30f3442d83a178b1d08052d4" } // <-- replace if needed
      });

      const view = new MapView({
        container: "viewDiv",
        map: webmap
      });

      const userStatusEl = document.getElementById("userStatus");
      const signOutBtn   = document.getElementById("signOutBtn");

      // 4) Load portal to show user info if available
      const portal = new Portal({ url: info.portalUrl });

      portal.load().then(function () {
        const creds = esriId.findCredential(info.portalUrl);
        if (creds && portal.user) {
          userStatusEl.textContent = "Signed in as: " + portal.user.username;
          signOutBtn.style.display = "inline-block";
        } else {
          userStatusEl.textContent = "Not signed in (will prompt if needed)";
        }
      });

      // 5) Sign-out
      signOutBtn.addEventListener("click", function () {
        esriId.destroyCredentials();
        window.location.reload();
      });

      // 6) Optional: log credential events & errors
      esriId.on("credential-create", function (event) {
        console.log("Credential created:", event.credential);
      });
      esriId.on("error", function (error) {
        console.error("IdentityManager error:", error);
      });

      // ---------------------------
      // Editor (web component) setup
      // ---------------------------

      // (A) verify the component is defined
      if (!customElements.get("arcgis-editor")) {
        console.warn(
          "The <arcgis-editor> custom element is not defined. " +
          "Did you include <script type=\"module\" src=\"https://js.arcgis.com/4.34/map-components\"></script> in index.html?"
        );
      }

      // (B) get the component from the DOM
      const editorEl = document.getElementById("editor");
      if (!editorEl) {
        console.warn("No element with id='editor' found. Add <arcgis-editor id=\"editor\"></arcgis-editor> to the HTML body.");
        return;
      }

      // (C) bind the MapView once it's ready
      await view.when();
      editorEl.view = view;

      // (D) load all layers before configuring Editor
      await webmap.loadAll();

      // (E) find the 'laadpalen' FeatureLayer (title or id contains 'laadpalen')
      const laadpalen = webmap.allLayers.find((lyr) =>
        lyr.type === "feature" &&
        (
          (lyr.title && lyr.title.toLowerCase().includes("laadpalen")) ||
          (lyr.id && lyr.id.toLowerCase().includes("laadpalen"))
        )
      );

      if (!laadpalen) {
        console.warn("Could not find a FeatureLayer named 'laadpalen' in the WebMap.");
        console.info("Layers present:", webmap.allLayers.map(l => ({ title: l.title, id: l.id, type: l.type })));
        return;
      }

      // (F) enable popups for better UX (select → update form)
      try { laadpalen.popupEnabled = true; } catch (_) {}

      // (G) construct a minimal form with just the one field
      const formTemplate = {
        elements: [
          {
            type: "field",
            fieldName: "laadpaal_geaccepteerd",
            label: "Laadpaal geaccepteerd"
          }
        ]
      };

      // (H) optional: set point drawing tool & default value through layer template
      try {
        await laadpalen.load();
        if (laadpalen.templates && laadpalen.templates.length) {
          const t = laadpalen.templates[0];
          t.drawingTool = "esriFeatureEditToolPoint"; // ensure point creation
          // Optionally prefill a default (uncomment and set the value you expect):
          // t.prototype = Object.assign({}, t.prototype, { laadpaal_geaccepteerd: true });
        }
      } catch (e) {
        console.warn("Could not load layer templates; continuing without default value.", e);
      }

      // (I) enable create + update (no delete). Limit visible workflows.
      editorEl.layerInfos = [
        {
          layer: laadpalen,
          formTemplate,
          addEnabled: true,       // allow creating new laadpalen points
          updateEnabled: true,    // allow editing existing laadpalen
          deleteEnabled: false
        }
      ];
      editorEl.allowedWorkflows = ["create", "update"];

      // (J) optional: enable snapping for precise placement
      try { view.map.snappingEnabled = true; } catch (_) {}

      console.log("Editor wired: create+update enabled on 'laadpalen', field: laadpaal_geaccepteerd");

    } catch (err) {
      console.error("initApp error:", err);
    }
  }
});
