// Shared by the display and control pages.
(function () {
  const ST = {};

  // Live connection (Server-Sent Events). Auto-reconnects; the server also re-sends state every second.
  ST.connect = function (onState, onStatus) {
    let offset = 0; // serverTime - clientTime
    let es;
    const open = () => {
      es = new EventSource('/api/events');
      es.onopen = () => onStatus && onStatus(true);
      es.onerror = () => onStatus && onStatus(false);
      es.onmessage = (e) => {
        const s = JSON.parse(e.data);
        offset = s.serverNow - Date.now();
        s.receivedAt = Date.now();
        onState(s);
      };
    };
    open();
    return { offset: () => offset };
  };

  // Elapsed ms right now, extrapolated from the last snapshot.
  ST.elapsed = (s, offset) => s.elapsedMs + (s.running ? Date.now() + offset - s.serverNow : 0);

  ST.fmt = function (totalSecs) {
    const s = Math.max(0, Math.floor(totalSecs));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
  };

  // Everything a view needs to draw the clock.
  ST.view = function (s, offset) {
    const elapsed = ST.elapsed(s, offset);
    const remainingMs = s.targetSecs * 1000 - elapsed;
    const over = remainingMs < 0;
    const secs = over ? Math.ceil(-remainingMs / 1000) : Math.ceil(remainingMs / 1000);
    let state = 'idle';
    if (over) state = 'over';
    else if (s.running && secs <= s.closingSecs) state = 'closing';
    else if (s.running) state = 'running';
    else if (elapsed > 0) state = 'stopped';
    return {
      text: (over ? '+' : '') + ST.fmt(secs),
      progress: s.targetSecs ? Math.min(1, elapsed / (s.targetSecs * 1000)) : 0,
      state,
      over,
    };
  };

  window.ST = ST;
})();
