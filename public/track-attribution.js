(function () {
  if (typeof window === "undefined") return;
  try {
    var params = new URLSearchParams(window.location.search);
    var sid = params.get("sid");
    var cid = params.get("cid");
    if (!sid || !cid) return;

    // POST to the email server's click endpoint, NOT to /api/track/click
    // on the host landing page. Landing pages typically use their own
    // Supabase project for ticketing / app data, so a relative /api/track/click
    // call would either 404 or insert into the wrong database. The email
    // server has the canonical subscriber_events table and the right env.
    var url =
      "https://email.dreamplaypianos.com/api/track/click?c=" + encodeURIComponent(cid) +
      "&s=" + encodeURIComponent(sid) +
      "&u=" + encodeURIComponent(window.location.href);

    // redirect:"manual" + mode:"no-cors" — the endpoint responds with a 302
    // intended for server-side redirect-mode clicks, harmless via fetch.
    // no-cors avoids CORS errors when calling cross-origin (script runs on
    // landing page; the email server is a different origin).
    // keepalive ensures the request fires even if the user navigates away.
    fetch(url, { redirect: "manual", keepalive: true, mode: "no-cors" })
      .catch(function () {});
  } catch (e) {
    /* swallow */
  }
})();
