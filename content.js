(() => {
  "use strict";

  // Chave nova (oficial)
  const STORAGE_KEY = "oz_shorts_clean_view_settings";

  // Chaves "legadas" (caso teu popup antigo salvava diferente)
  const LEGACY_KEYS = [
    "shorts_clean_view_settings",
    "oz_shorts_settings",
    "shortsCleanerSettings",
    "settings"
  ];

  const CLASS_ON = "oz-shorts-dock-on";
  const STYLE_ID = "oz-shorts-dock-style";
  const DOCK_ID = "oz-shorts-dock";
  const DOCK_INNER_ID = "oz-shorts-dock-inner";
  const MOVED_CLASS = "oz-shorts-panel";

  const DEFAULTS = {
    enabled: true,
    side: "left",            // left | right
    vAlign: "bottom",        // top | center | bottom
    dockWidthPx: 300,
    dockGapPx: 0,
    dimBackground: true,
    compact: true,
    autoAnchorToPlayer: true
  };

  let lastMovedMetapanel = null;
  let lastMetapanelParent = null;
  let lastMetapanelNextSibling = null;

  let rafScheduled = false;
  let isScrolling = false;
  let scrollTimer = null;
  let pinnedPos = null;
  let lastLayoutKey = "";
  let lastViewportKey = "";

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts");
  }

  function normalizeSettings(s) {
    const out = { ...DEFAULTS, ...(s || {}) };

    out.enabled = !!out.enabled;
    out.side = out.side === "right" ? "right" : "left";
    out.vAlign = (out.vAlign === "top" || out.vAlign === "center") ? out.vAlign : "bottom";
    out.dockWidthPx = clamp(parseInt(out.dockWidthPx ?? DEFAULTS.dockWidthPx, 10), 240, 520);
    out.dockGapPx = clamp(parseInt(out.dockGapPx ?? DEFAULTS.dockGapPx, 10), 0, 40);
    out.dimBackground = !!out.dimBackground;
    out.compact = !!out.compact;
    // Força ancoragem sempre ligada
    out.autoAnchorToPlayer = true;

    return out;
  }

  function getStorage(area) {
    return area === "local" ? chrome.storage.local : chrome.storage.sync;
  }

  async function storageGet(area, key) {
    return new Promise((resolve) => {
      getStorage(area).get([key], (res) => resolve(res[key]));
    });
  }

  async function storageSet(area, key, value) {
    return new Promise((resolve) => {
      getStorage(area).set({ [key]: value }, () => resolve());
    });
  }

  async function getSettings() {
    // 1) tenta sync na chave nova
    let s = await storageGet("sync", STORAGE_KEY);
    if (s && typeof s === "object") return normalizeSettings(s);

    // 2) tenta local na chave nova (alguns setups usam local)
    s = await storageGet("local", STORAGE_KEY);
    if (s && typeof s === "object") return normalizeSettings(s);

    // 3) tenta chaves legadas no sync/local e migra
    for (const k of LEGACY_KEYS) {
      const legacySync = await storageGet("sync", k);
      if (legacySync && typeof legacySync === "object") {
        const norm = normalizeSettings(legacySync);
        await storageSet("sync", STORAGE_KEY, norm);
        return norm;
      }

      const legacyLocal = await storageGet("local", k);
      if (legacyLocal && typeof legacyLocal === "object") {
        const norm = normalizeSettings(legacyLocal);
        // migra pro sync também
        await storageSet("sync", STORAGE_KEY, norm);
        return norm;
      }
    }

    // 4) nada encontrado
    return normalizeSettings(null);
  }

  function ensureStyleEl() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    return style;
  }

  function ensureDock() {
    let dock = document.getElementById(DOCK_ID);
    if (!dock) {
      dock = document.createElement("div");
      dock.id = DOCK_ID;

      const inner = document.createElement("div");
      inner.id = DOCK_INNER_ID;

      dock.appendChild(inner);
      document.body.appendChild(dock);
    }
    return dock;
  }

  function removeDock() {
    const dock = document.getElementById(DOCK_ID);
    if (dock) dock.remove();
  }

  function buildCss(settings) {
    const bg = settings.dimBackground ? "rgba(0,0,0,0.58)" : "transparent";
    const border = settings.dimBackground ? "1px solid rgba(255,255,255,0.12)" : "none";
    const radius = settings.dimBackground ? "14px" : "0";
    const shadow = settings.dimBackground ? "0 14px 40px rgba(0,0,0,0.45)" : "none";
    const baseScale = settings.compact ? 0.92 : 1;

    return `
html.${CLASS_ON} #${DOCK_ID} {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  width: ${settings.dockWidthPx}px;
  max-width: ${settings.dockWidthPx}px;
  transform: scale(calc(var(--oz-auto-scale, 1) * ${baseScale}));
  transition: top 180ms ease, left 180ms ease, transform 180ms ease;
  will-change: top, left, transform;
}

html.${CLASS_ON} #${DOCK_INNER_ID} {
  pointer-events: auto;
  width: 100%;
  height: 100%;
  background: ${bg};
  border: ${border};
  border-radius: ${radius};
  box-shadow: ${shadow};
  padding: 10px;
  box-sizing: border-box;
  overflow: hidden;
}

html.${CLASS_ON} #${DOCK_INNER_ID} .${MOVED_CLASS} {
  position: static !important;
  width: 100% !important;
  max-width: 100% !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

@media (prefers-reduced-motion: reduce) {
  html.${CLASS_ON} #${DOCK_ID} {
    transition: none;
  }
}
`;
  }

  function findMetapanel() {
    const overlay = document.querySelector("ytd-reel-player-overlay-renderer");
    if (!overlay) return null;

    return overlay.querySelector("#metapanel") || overlay.querySelector("#meta-panel");
  }

  function moveMetapanelIntoDock() {
    const dock = ensureDock();
    const inner = dock.querySelector(`#${DOCK_INNER_ID}`);
    if (!inner) return;

    const metapanel = findMetapanel();
    if (!metapanel) return;

    if (inner.contains(metapanel)) return;

    metapanel.classList.add(MOVED_CLASS);
    lastMovedMetapanel = metapanel;
    lastMetapanelParent = metapanel.parentNode;
    lastMetapanelNextSibling = metapanel.nextSibling;

    inner.appendChild(metapanel);
  }

  function restoreMetapanel() {
    if (!lastMovedMetapanel) return;

    const metapanel = lastMovedMetapanel;

    if (!metapanel.isConnected) {
      lastMovedMetapanel = null;
      lastMetapanelParent = null;
      lastMetapanelNextSibling = null;
      return;
    }

    const dockInner = document.getElementById(DOCK_INNER_ID);
    if (dockInner && dockInner.contains(metapanel)) {
      if (lastMetapanelParent && lastMetapanelParent.isConnected) {
        if (lastMetapanelNextSibling && lastMetapanelNextSibling.isConnected) {
          lastMetapanelParent.insertBefore(metapanel, lastMetapanelNextSibling);
        } else {
          lastMetapanelParent.appendChild(metapanel);
        }
      }
    }

    metapanel.classList.remove(MOVED_CLASS);
    lastMovedMetapanel = null;
    lastMetapanelParent = null;
    lastMetapanelNextSibling = null;
  }

  function getPlayerRect() {
    const el =
      document.querySelector("ytd-reel-video-renderer #short-video-container") ||
      document.querySelector("#short-video-container") ||
      document.querySelector("ytd-reel-video-renderer");

    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) return null;
    return r;
  }

  function getGuideRect() {
    const guide =
      document.querySelector("ytd-app ytd-guide-renderer") ||
      document.querySelector("ytd-guide-renderer");

    if (!guide) return null;

    const r = guide.getBoundingClientRect();
    if (r.width < 40 || r.height < 100) return null;
    return r;
  }

  function positionDock(settings) {
    const dock = document.getElementById(DOCK_ID);
    if (!dock) return;

    const gap = settings.dockGapPx;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const baseScale = settings.compact ? 0.92 : 1;
    dock.style.transformOrigin = "left top";
    const layoutKey = `${settings.side}|${settings.vAlign}|${settings.dockWidthPx}|${settings.dockGapPx}|${settings.compact}`;
    const viewportKey = `${viewportW}x${viewportH}`;
    const needReposition = !pinnedPos || layoutKey !== lastLayoutKey || viewportKey !== lastViewportKey;

    // Se não ancorar no player: prende na tela, mas respeita vAlign
    if (!settings.autoAnchorToPlayer) {
      const height = Math.round(viewportH - gap * 2);
      dock.style.setProperty("--oz-auto-scale", "1");
      dock.style.height = `${height}px`;

      const visualHeight = height * baseScale;
      let top = gap;
      if (settings.vAlign === "center") top = Math.round((viewportH - visualHeight) / 2);
      if (settings.vAlign === "bottom") top = Math.round(viewportH - visualHeight - gap);
      dock.style.top = `${top}px`;

      if (settings.side === "left") {
        dock.style.left = `${gap}px`;
        dock.style.right = "auto";
      } else {
        dock.style.right = `${gap}px`;
        dock.style.left = "auto";
      }
      return;
    }

    const playerRect = getPlayerRect();
    if (!playerRect) return;

    const guideRect = getGuideRect();

    const safeLeft = guideRect ? (guideRect.left + guideRect.width + gap) : gap;
    const safeRight = gap;

    const maxWidthLeft = Math.max(0, playerRect.left - gap - safeLeft);
    const maxWidthRight = Math.max(0, viewportW - safeRight - (playerRect.right + gap));

    let side = pinnedPos ? pinnedPos.side : settings.side;
    if (needReposition) {
      side = settings.side;
      if (side === "left" && maxWidthLeft < 80 && maxWidthRight > maxWidthLeft) {
        side = "right";
      } else if (side === "right" && maxWidthRight < 80 && maxWidthLeft > maxWidthRight) {
        side = "left";
      }
    }

    const dockInner = document.getElementById(DOCK_INNER_ID);
    const metapanel = lastMovedMetapanel || (dockInner ? dockInner.querySelector(`.${MOVED_CLASS}`) : null);

    let contentHeight = 0;
    if (metapanel && metapanel.isConnected) {
      contentHeight = Math.round(metapanel.getBoundingClientRect().height);
    }
    if (dockInner) {
      contentHeight = Math.max(contentHeight, Math.round(dockInner.scrollHeight));
    }

    const rawHeight = contentHeight || 140;
    const maxHeight = Math.max(140, viewportH - gap * 2);
    const availableHeight = pinnedPos && !needReposition
      ? Math.max(140, viewportH - gap - pinnedPos.top)
      : maxHeight;
    const verticalScale = contentHeight
      ? Math.min(1, availableHeight / (rawHeight * baseScale))
      : 1;
    const maxWidthSide = side === "left" ? maxWidthLeft : maxWidthRight;
    const availableWidth = pinnedPos && !needReposition
      ? (
        side === "left"
          ? Math.max(0, playerRect.left - gap - pinnedPos.left)
          : Math.max(0, viewportW - safeRight - pinnedPos.left)
      )
      : maxWidthSide;
    const widthScale = availableWidth > 0
      ? Math.min(1, availableWidth / (settings.dockWidthPx * baseScale))
      : 1;
    const autoScale = Math.min(verticalScale, widthScale);
    const height = Math.max(140, Math.round(rawHeight));

    dock.style.setProperty("--oz-auto-scale", autoScale.toFixed(3));
    dock.style.height = `${Math.round(height)}px`;

    // vAlign: top/center/bottom (bottom = “lá embaixo”)
    const visualHeight = height * baseScale * autoScale;
    let top;
    if (pinnedPos && !needReposition) {
      top = pinnedPos.top;
    } else {
      top = Math.round(playerRect.top);
      if (settings.vAlign === "center") top = Math.round(playerRect.top + (playerRect.height - visualHeight) / 2);
      if (settings.vAlign === "bottom") top = Math.round(playerRect.bottom - visualHeight);
      top = clamp(top, gap, viewportH - visualHeight - gap);
    }
    dock.style.top = `${top}px`;

    const visualWidth = settings.dockWidthPx * baseScale * autoScale;
    const maxLeft = viewportW - safeRight - visualWidth;
    const minLeft = side === "left" ? safeLeft : gap;

    // Lado: esquerda/direita (com auto-ajuste de espaço)
    let left;
    if (pinnedPos && !needReposition) {
      left = pinnedPos.left;
    } else if (side === "left") {
      const desiredLeft = Math.round(playerRect.left - gap - visualWidth);
      left = clamp(desiredLeft, minLeft, maxLeft);
    } else {
      const desiredLeft = Math.round(playerRect.right + gap);
      left = clamp(desiredLeft, minLeft, maxLeft);
    }
    dock.style.left = `${left}px`;
    dock.style.right = "auto";

    if (needReposition) {
      pinnedPos = { top, left, side };
      lastLayoutKey = layoutKey;
      lastViewportKey = viewportKey;
    }
  }

  async function apply(settings) {
    const style = ensureStyleEl();
    const shouldEnable = settings.enabled && isShortsPage();

    if (shouldEnable) {
      document.documentElement.classList.add(CLASS_ON);
      style.textContent = buildCss(settings);

      ensureDock();
      moveMetapanelIntoDock();
      positionDock(settings);
    } else {
      document.documentElement.classList.remove(CLASS_ON);
      style.textContent = "";
      restoreMetapanel();
      removeDock();
      pinnedPos = null;
      lastLayoutKey = "";
      lastViewportKey = "";
    }
  }

  async function refresh() {
    const settings = await getSettings();
    await apply(settings);
  }

  function scheduleReposition(force = false) {
    if (rafScheduled) return;
    if (isScrolling && !force) return;
    rafScheduled = true;
    requestAnimationFrame(async () => {
      rafScheduled = false;
      const settings = await getSettings();
      if (!document.documentElement.classList.contains(CLASS_ON)) return;
      if (!isShortsPage()) return;
      moveMetapanelIntoDock();
      positionDock(settings);
    });
  }

  function hookSpaNavigation() {
    let lastHref = location.href;

    const obs = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        setTimeout(refresh, 50);
        return;
      }
      if (document.documentElement.classList.contains(CLASS_ON) && isShortsPage()) {
        scheduleReposition();
      }
    });

    obs.observe(document.documentElement, { subtree: true, childList: true });

    const pushState = history.pushState;
    const replaceState = history.replaceState;

    history.pushState = function () {
      pushState.apply(this, arguments);
      setTimeout(refresh, 50);
    };

    history.replaceState = function () {
      replaceState.apply(this, arguments);
      setTimeout(refresh, 50);
    };

    window.addEventListener("popstate", () => setTimeout(refresh, 50));
    window.addEventListener("resize", () => scheduleReposition());
    window.addEventListener(
      "scroll",
      () => {
        isScrolling = true;
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          isScrolling = false;
          scheduleReposition(true);
        }, 140);
      },
      { passive: true }
    );
  }

  // Se qualquer storage mudar, atualiza (sync e local)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" && area !== "local") return;
    if (changes[STORAGE_KEY]) refresh();
  });

  hookSpaNavigation();
  refresh();
})();
