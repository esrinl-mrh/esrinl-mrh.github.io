
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
    popup: true                                        // use popup for sign-in
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
  }
});
