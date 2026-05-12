(function () {
  if (typeof window === "undefined") return;
  try {
    var params = new URLSearchParams(window.location.search);
    var sid = params.get("sid");
    var cid = params.get("cid");
    if (!sid || !cid) return;

    var url =
      "/api/track/click?c=" + encodeURIComponent(cid) +
      "&s=" + encodeURIComponent(sid) +
      "&u=" + encodeURIComponent(window.location.href);

    fetch(url, { redirect: "manual", keepalive: true, mode: "no-cors" })
      .catch(function () {});
  } catch (e) {
    /* swallow */
  }
})();
