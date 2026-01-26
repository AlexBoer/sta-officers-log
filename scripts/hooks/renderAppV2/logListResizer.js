import { MODULE_ID } from "../../core/constants.js";
import {
  getCharacterLogMaxHeightSetting,
  getCharacterMilestoneMaxHeightSetting,
} from "../../settings/clientSettings.js";

function _getPxNumber(value) {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d+(?:\.\d+)?)px$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function _clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

const minHeight = 150;

function _applyHeight(el, px) {
  if (!el) return;
  const n = Math.round(Number(px));
  if (!Number.isFinite(n) || n <= 0) return;
  // Set both so the divider moves immediately even if the list would normally
  // shrink-wrap to content (max-height alone won't reduce height until it
  // drops below content height).
  el.style.height = `${n}px`;
  el.style.maxHeight = `${n}px`;
}

function _getCurrentHeightPx(el) {
  if (!el) return null;
  const inline = _getPxNumber(el.style?.height);
  if (inline && inline > 0) return inline;
  const inlineMax = _getPxNumber(el.style?.maxHeight);
  if (inlineMax && inlineMax > 0) return inlineMax;
  try {
    const rect = el.getBoundingClientRect?.();
    const h = Number(rect?.height);
    return Number.isFinite(h) && h > 0 ? h : null;
  } catch (_) {
    return null;
  }
}

export function installCharacterLogListResizer(root) {
  if (!root) return;

  const section = root.querySelector?.("div.section.milestones");
  if (!section) return;

  // STA v2.4.6+: logs and milestones are separate scrollable siblings.
  const scrollableLists = Array.from(
    section.querySelectorAll(":scope > .item-list-scrollable"),
  ).filter((el) => el instanceof HTMLElement);

  const logListScrollable =
    scrollableLists.find((el) =>
      el.querySelector('li.row.entry[data-item-type="log"]'),
    ) ?? null;

  const milestoneListScrollable =
    scrollableLists.find((el) =>
      el.querySelector('li.row.entry[data-item-type="milestone"]'),
    ) ?? null;

  if (!logListScrollable && !milestoneListScrollable) return;

  const installResizer = ({
    listEl,
    resizerClass,
    ariaLabel,
    settingKey,
    getSetting,
  }) => {
    if (!listEl) return;

    // Insert the resizer between the list and whatever follows.
    const insertBefore = listEl.nextElementSibling;
    const existing = insertBefore?.previousElementSibling?.classList?.contains(
      resizerClass,
    )
      ? insertBefore.previousElementSibling
      : section.querySelector(`:scope > .${resizerClass}`);

    const resizer = existing instanceof HTMLElement ? existing : null;

    const currentSetting = getSetting?.();
    const initialHeight =
      typeof currentSetting === "number" && Number.isFinite(currentSetting)
        ? Math.max(currentSetting, minHeight)
        : minHeight;

    _applyHeight(listEl, initialHeight);

    if (resizer) {
      // Keep min-height data current (system CSS might change across versions)
      resizer.dataset.minHeight = String(minHeight);
      return;
    }

    const bar = document.createElement("div");
    bar.className = resizerClass;
    bar.setAttribute("role", "separator");
    bar.setAttribute("aria-label", ariaLabel);
    bar.tabIndex = 0;
    bar.dataset.minHeight = String(minHeight);

    // Only insert if we have a stable anchor.
    if (insertBefore) section.insertBefore(bar, insertBefore);
    else section.appendChild(bar);

    let dragState = null;
    let rafId = 0;

    const flushRaf = () => {
      rafId = 0;
      if (!dragState) return;
      if (typeof dragState.pendingHeight !== "number") return;
      _applyHeight(listEl, dragState.pendingHeight);
    };

    const scheduleFlush = () => {
      if (rafId) return;
      rafId = globalThis.requestAnimationFrame
        ? globalThis.requestAnimationFrame(flushRaf)
        : setTimeout(flushRaf, 0);
    };

    const onPointerMove = (ev) => {
      if (!dragState) return;
      if (dragState.pointerId != null && ev.pointerId !== dragState.pointerId)
        return;

      ev.preventDefault();

      const delta = ev.clientY - dragState.startY;
      const next = _clamp(
        dragState.startHeight + delta,
        dragState.minHeight,
        dragState.maxHeight,
      );

      dragState.pendingHeight = next;
      scheduleFlush();
    };

    const finishDrag = async () => {
      if (!dragState) return;

      // Ensure last queued update is applied before persisting.
      try {
        flushRaf();
      } catch (_) {
        // ignore
      }

      const finalHeight = _clamp(
        _getCurrentHeightPx(listEl) ?? dragState.startHeight,
        dragState.minHeight,
        dragState.maxHeight,
      );

      const pointerId = dragState.pointerId;
      dragState = null;

      try {
        if (typeof pointerId === "number")
          bar.releasePointerCapture?.(pointerId);
      } catch (_) {
        // ignore
      }

      try {
        document.body?.classList?.remove?.("staol-resize-dragging");
      } catch (_) {
        // ignore
      }

      try {
        await game.settings.set(MODULE_ID, settingKey, finalHeight);
      } catch (_) {
        // ignore
      }
    };

    const onPointerUp = async (ev) => {
      if (!dragState) return;
      if (dragState.pointerId != null && ev.pointerId !== dragState.pointerId)
        return;
      ev.preventDefault();
      await finishDrag();
    };

    const onPointerCancel = async (ev) => {
      if (!dragState) return;
      if (dragState.pointerId != null && ev.pointerId !== dragState.pointerId)
        return;
      await finishDrag();
    };

    const onPointerDown = (ev) => {
      // Left click / primary touch only
      if (ev.button !== 0) return;
      if (ev.isPrimary === false) return;

      ev.preventDefault();
      ev.stopPropagation();

      const startHeight =
        _getCurrentHeightPx(listEl) ??
        _getPxNumber(globalThis.getComputedStyle?.(listEl)?.maxHeight) ??
        minHeight;

      dragState = {
        pointerId: ev.pointerId,
        startY: ev.clientY,
        startHeight,
        pendingHeight: startHeight,
        minHeight: minHeight,
        maxHeight: 1000,
      };

      try {
        bar.setPointerCapture?.(ev.pointerId);
      } catch (_) {
        // ignore
      }

      try {
        document.body?.classList?.add?.("staol-resize-dragging");
      } catch (_) {
        // ignore
      }
    };

    // Prefer Pointer Events for smoother dragging and reliable capture.
    bar.addEventListener("pointerdown", onPointerDown);
    bar.addEventListener("pointermove", onPointerMove);
    bar.addEventListener("pointerup", onPointerUp);
    bar.addEventListener("pointercancel", onPointerCancel);

    // Keyboard accessibility: arrow up/down adjusts by 10px.
    bar.addEventListener("keydown", async (ev) => {
      const key = ev.key;
      if (key !== "ArrowUp" && key !== "ArrowDown") return;
      ev.preventDefault();
      ev.stopPropagation();

      const cur =
        _getCurrentHeightPx(listEl) ??
        _getPxNumber(globalThis.getComputedStyle?.(listEl)?.maxHeight) ??
        minHeight;

      const step = ev.shiftKey ? 25 : 10;
      const next = _clamp(
        cur + (key === "ArrowDown" ? step : -step),
        minHeight,
        1000,
      );

      _applyHeight(listEl, next);

      try {
        await game.settings.set(MODULE_ID, settingKey, next);
      } catch (_) {
        // ignore
      }
    });
  };

  installResizer({
    listEl: logListScrollable,
    resizerClass: "staol-log-resizer",
    ariaLabel: "Resize Character Log",
    settingKey: "characterLogMaxHeight",
    getSetting: getCharacterLogMaxHeightSetting,
  });

  installResizer({
    listEl: milestoneListScrollable,
    resizerClass: "staol-milestone-resizer",
    ariaLabel: "Resize Milestones",
    settingKey: "characterMilestoneMaxHeight",
    getSetting: getCharacterMilestoneMaxHeightSetting,
  });
}
