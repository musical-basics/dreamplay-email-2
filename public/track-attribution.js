(function () {
  if (typeof window === "undefined") return;
  try {
    var params = new URLSearchParams(window.location.search);
    var sid = params.get("sid");
    var cid = params.get("cid");
    if (!sid || !cid) return;

    var endpoint =
      "https://email.dreamplaypianos.com/api/track/click?c=" + encodeURIComponent(cid) +
      "&s=" + encodeURIComponent(sid) +
      "&u=" + encodeURIComponent(window.location.href);

    // Fire via Image beacon for maximum cross-browser reliability.
    // Image requests bypass CORS, ITP-style cross-origin fetch
    // restrictions, and most ad/tracker blockers' fetch-based heuristics.
    // The endpoint logs the click then returns a 302; the browser tries
    // to load the redirected URL as an image, fails silently, no impact.
    // navigator.sendBeacon is even better (designed for this) but has
    // tighter content-type constraints. Image works universally.
    try {
      var beacon = new Image();
      beacon.src = endpoint;
    } catch (e) {
      // Fallback to fetch if Image is somehow unavailable.
      if (typeof fetch === "function") {
        fetch(endpoint, { mode: "no-cors", keepalive: true, redirect: "manual" })
          .catch(function () {});
      }
    }
  } catch (e) {
    /* swallow */
  }
})();
