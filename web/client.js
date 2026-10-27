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
  // state: idle | stopped | running | minute (glow) | half (flash amber) | ten (flash red) | up (time's up) | over
  ST.view = function (s, offset) {
    const elapsed = ST.elapsed(s, offset);
    const remainingMs = s.targetSecs * 1000 - elapsed;
    const over = remainingMs < 0;
    const secs = over ? Math.ceil(-remainingMs / 1000) : Math.ceil(remainingMs / 1000);
    const cur = (s.items || []).find((i) => i.id === s.currentId);
    // Short parts (e.g. Opening Comments) don't get the one-minute warning.
    const skipMinute = !cur || cur.key === 'opening' || s.targetSecs <= 120;

    let state = 'idle';
    if (s.running) {
      if (remainingMs <= 0) state = -remainingMs < 15000 ? 'up' : 'over';
      else if (secs <= 10) state = 'ten';
      else if (secs <= 30) state = 'half';
      else if (secs <= 60 && !skipMinute) state = 'minute';
      else state = 'running';
    } else if (elapsed > 0) {
      state = over ? 'over' : 'stopped';
    }
    return {
      text: (over ? '+' : '') + ST.fmt(secs),
      progress: s.targetSecs ? Math.min(1, elapsed / (s.targetSecs * 1000)) : 0,
      state,
      over,
    };
  };

  // In-page pop-up (no system notification, no sound) shown when a warning stage is entered.
  const MESSAGES = { minute: ['1 minute left', 4000], half: ['30 seconds', 3500], ten: ['10 seconds', 3000], up: ['Time’s up', 15000] };
  ST.alerter = function (el) {
    let prev = null;
    let prevTalk = null;
    let timer = null;
    return function update(state, talkId) {
      if (prev === null || talkId !== prevTalk) {
        // first frame / different part: don't announce a stage we merely joined
        prev = state;
        prevTalk = talkId;
        if (talkId !== null) hide();
        return;
      }
      if (state !== prev) {
        const m = MESSAGES[state];
        if (m) show(state, m);
        else if (prev === 'up') hide();
        prev = state;
      }
    };
    function show(kind, m) {
      el.textContent = m[0];
      el.dataset.kind = kind;
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(hide, m[1]);
    }
    function hide() {
      clearTimeout(timer);
      el.classList.remove('show');
    }
  };

  window.ST = ST;
})();
