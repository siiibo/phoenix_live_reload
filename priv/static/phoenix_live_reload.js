//
// Patch this file to enable HMR; Hot Module Reloading for other asset types
//

var buildFreshUrl = function (link) {
  var date = Math.round(Date.now() / 1000).toString();
  var url = link.href.replace(/(\&|\\?)vsn=\d*/, "");
  var newLink = document.createElement("link");
  var onComplete = function () {
    if (link.parentNode !== null) {
      link.parentNode.removeChild(link);
    }
  };

  newLink.onerror = onComplete;
  newLink.onload = onComplete;
  link.setAttribute("data-pending-removal", "");
  newLink.setAttribute("rel", "stylesheet");
  newLink.setAttribute("type", "text/css");
  newLink.setAttribute(
    "href",
    url + (url.indexOf("?") >= 0 ? "&" : "?") + "vsn=" + date
  );
  link.parentNode.insertBefore(newLink, link.nextSibling);

  return newLink;
};

var repaint = function () {
  var browser = navigator.userAgent.toLowerCase();
  if (browser.indexOf("chrome") > -1) {
    setTimeout(function () {
      document.body.offsetHeight;
    }, 25);
  }
};

var cssStrategy = function () {
  var reloadableLinkElements = window.parent.document.querySelectorAll(
    "link[rel=stylesheet]:not([data-no-reload]):not([data-pending-removal])"
  );

  [].slice
    .call(reloadableLinkElements)
    .filter(function (link) {
      return link.href;
    })
    .forEach(function (link) {
      buildFreshUrl(link);
    });

  repaint();
};

var pageStrategy = function (chan) {
  chan.off("assets_change");
  window.top.location.reload();
};

//
// Patched functions begin
//

var jsStrategy = function (chan, msg) {
  console.info("[HMR] JS file updated", msg);
  // HACK When a JS file updated, we search for corresponding <script> tag with [data-hmr] attribute.
  // If found, we try HMR (via doHMR() function), otherwise reload the page.
  var hmrTargetQuery = `script[src*='${msg.path}'][data-hmr]`;
  if (
    window.parent.document.querySelector(hmrTargetQuery) &&
    window.parent.doHMR
  ) {
    console.info(`[HMR] Initiating HMR... (${msg.path})`);
    // Migrated from https://github.com/klazuka/elm-hot/blob/master/test/client.js
    var hmrTargetReq = new Request(msg.path);
    hmrTargetReq.cache = "no-cache";
    fetch(hmrTargetReq).then(function (res) {
      if (res.ok) {
        res.text().then(function (newModule) {
          window.parent.doHMR(newModule);
          console.info(`[HMR] Done! (${msg.path})`);
        });
      } else {
        // Debug here
        console.error(`[HMR] Fetch failed (${msg.path}):`, res.statusText);
      }
    });
  } else {
    console.info(`[HMR] Not-applicable. Reloading page... (${msg.path})`);
    window.top.location.reload();
  }
};

//
// Patched functions end
//

var reloadStrategies = {
  css: cssStrategy,
  page: pageStrategy,
  js: jsStrategy,
};

socket.connect();
var chan = socket.channel("phoenix:live_reload", {});
chan.on("assets_change", function (msg) {
  var reloadStrategy =
    reloadStrategies[msg.asset_type] || reloadStrategies.page;
  setTimeout(function () {
    reloadStrategy(chan, msg);
  }, interval);
});
chan.join().receive("ok", () => console.log("[PhoenixLiveReload] Connected!"));
