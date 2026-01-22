
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

  function initApp() {
    // 3) Create a (secured) webmap
    const webmap = new WebMap({
      portalItem: {
        id: "5140997c30f3442d83a178b1d08052d4"  // <-- replace with your (possibly secured) webmap id
      }
    });

    const view = new MapView({
      container: "viewDiv",
      map: webmap
    });

    const userStatusEl = document.getElementById("userStatus");
    const signOutBtn = document.getElementById("signOutBtn");

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
      // Reload to clear state
      window.location.reload();
    });

    // 6) Optional: log credential events & errors
    esriId.on("credential-create", function (event) {
      console.log("Credential created:", event.credential);
    });

    esriId.on("error", function (error) {
      console.error("IdentityManager error:", error);
    });

    // -----------------------------
    // 7) Editor web component setup
    // -----------------------------
    // Requires: <script src="https://js.arcgis.com/4.34/map-components"></script>
    // And in HTML body: <arcgis-editor id="editor" position="top-right"></arcgis-editor>
    const editorEl = document.getElementById("editor");
    // Bind the Editor component to the MapView
    editorEl.view = view;

    view.when(async () => {
      // Ensure all layers are ready
      await webmap.loadAll();

      // Find the 'laadpalen' FeatureLayer by title or id
      const laadpalen = webmap.allLayers.find((lyr) =>
        lyr.type === "feature" &&
        ((lyr.title && lyr.title.toLowerCase().includes("laadpalen")) ||
         (lyr.id && lyr.id.toLowerCase().includes("laadpalen")))
      );

      if (!laadpalen) {
        console.warn("Could not find a FeatureLayer named 'laadpalen' in the WebMap.");
        return;
      }

      // Enable popups for a smoother edit experience (select → update form)
      try { laadpalen.popupEnabled = true; } catch (_) {}

      // Minimal form: only laadpaal_geaccepteerd
      const formTemplate = {
        elements: [
          {
            type: "field",
            fieldName: "laadpaal_geaccepteerd",
            label: "Laadpaal geaccepteerd"
            // If boolean or coded value domain, the Editor renders a switch/dropdown automatically
          }
        ]
      };

      // Optional: ensure point creation tool and (optionally) a default value
      try {
        await laadpalen.load();
        if (laadpalen.templates && laadpalen.templates.length) {
          const t = laadpalen.templates[0];
          t.drawingTool = "esriFeatureEditToolPoint"; // ensure point geometry tool
          // Set a default if your schema expects it (uncomment and set value you want):
          // t.prototype = Object.assign({}, t.prototype, { laadpaal_geaccepteerd: true });
        }
      } catch (e) {
        console.warn("Could not load layer templates; continuing without default value.", e);
      }

      // Enable CREATE + UPDATE (no delete). Also limit visible workflows in the UI.
      editorEl.layerInfos = [
        {
          layer: laadpalen,
          formTemplate,
          addEnabled: true,       // ✅ allow creating new laadpalen points
          updateEnabled: true,    // ✅ allow editing existing features
          deleteEnabled: false
        }
      ];

      editorEl.allowedWorkflows = ["create", "update"];

      // Optional: snapping for precise placement (if supported)
      try { view.map.snappingEnabled = true; } catch (_) {}
    });
  }
});
