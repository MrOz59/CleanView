(() => {
  "use strict";

  const STORAGE_KEY = "oz_shorts_clean_view_settings";

  // (Compat) If an older popup used another key, content.js will migrate it.
  const DEFAULTS = {
    enabled: true,
    side: "left",
    vAlign: "bottom", // top | center | bottom
    dockWidthPx: 300,
    dockGapPx: 0,
    dimBackground: true,
    compact: true,
    autoAnchorToPlayer: true
  };

  const elEnabled = document.getElementById("enabled");
  const elVAlign = document.getElementById("vAlign");
  const elDockWidth = document.getElementById("dockWidthPx");
  const elDockWidthValue = document.getElementById("dockWidthValue");
  const elDockGap = document.getElementById("dockGapPx");
  const elDockGapValue = document.getElementById("dockGapValue");
  const elDimBackground = document.getElementById("dimBackground");
  const elCompact = document.getElementById("compact");

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function normalize(s) {
    const out = { ...DEFAULTS, ...(s || {}) };
    out.side = "left";
    out.vAlign = (out.vAlign === "top" || out.vAlign === "center") ? out.vAlign : "bottom";
    out.dockWidthPx = clamp(parseInt(out.dockWidthPx ?? DEFAULTS.dockWidthPx, 10), 240, 520);
    out.dockGapPx = clamp(parseInt(out.dockGapPx ?? DEFAULTS.dockGapPx, 10), 0, 40);
    out.enabled = !!out.enabled;
    out.dimBackground = !!out.dimBackground;
    out.compact = !!out.compact;
    out.autoAnchorToPlayer = true;
    return out;
  }

  function getSync(cb) {
    chrome.storage.sync.get([STORAGE_KEY], (res) => cb(res[STORAGE_KEY]));
  }

  function setSync(value, cb) {
    chrome.storage.sync.set({ [STORAGE_KEY]: value }, cb);
  }

  function load() {
    getSync((saved) => {
      const s = normalize(saved);

      elEnabled.checked = s.enabled;
      elVAlign.value = s.vAlign;

      elDockWidth.value = s.dockWidthPx;
      elDockWidthValue.textContent = `${s.dockWidthPx}px`;

      elDockGap.value = s.dockGapPx;
      elDockGapValue.textContent = `${s.dockGapPx}px`;

      elDimBackground.checked = s.dimBackground;
      elCompact.checked = s.compact;
    });
  }

  function save(partial) {
    getSync((current) => {
      const next = normalize({ ...(current || {}), ...partial });
      setSync(next);
    });
  }

  elEnabled.addEventListener("change", () => save({ enabled: elEnabled.checked }));
  elVAlign.addEventListener("change", () => save({ vAlign: elVAlign.value }));

  elDockWidth.addEventListener("input", () => {
    elDockWidthValue.textContent = `${elDockWidth.value}px`;
  });
  elDockWidth.addEventListener("change", () =>
    save({ dockWidthPx: parseInt(elDockWidth.value, 10) })
  );

  elDockGap.addEventListener("input", () => {
    elDockGapValue.textContent = `${elDockGap.value}px`;
  });
  elDockGap.addEventListener("change", () =>
    save({ dockGapPx: parseInt(elDockGap.value, 10) })
  );

  elDimBackground.addEventListener("change", () =>
    save({ dimBackground: elDimBackground.checked })
  );
  elCompact.addEventListener("change", () =>
    save({ compact: elCompact.checked })
  );
  load();
})();
