import { MODULE_ID } from "../../core/constants.js";

let _staOpenContextMenuEl = null;
let _staOpenContextMenuCleanup = null;

/**
 * Close any currently open STA Officers Log context menu.
 */
export function closeStaOfficersLogContextMenu() {
  try {
    _staOpenContextMenuCleanup?.();
  } catch (_) {
    // ignore
  }
  _staOpenContextMenuCleanup = null;

  try {
    _staOpenContextMenuEl?.remove?.();
  } catch (_) {
    // ignore
  }
  _staOpenContextMenuEl = null;
}

/**
 * Open a simple context menu near the specified coordinates.
 * @param {Object} options
 * @param {number} options.x - The x coordinate (left edge).
 * @param {number} options.y - The y coordinate (top edge).
 * @param {string} options.label - The label text for the menu item.
 * @param {Function} options.onClick - Async callback when the item is clicked.
 */
export function openStaOfficersLogContextMenu({ x, y, label, onClick }) {
  closeStaOfficersLogContextMenu();

  const menu = document.createElement("nav");
  // Reuse Foundry's context menu classes so we inherit core styling.
  menu.className = "context-menu sta-officers-log-context-menu";
  menu.setAttribute("role", "menu");
  menu.style.position = "fixed";
  menu.style.left = `${Number(x) || 0}px`;
  menu.style.top = `${Number(y) || 0}px`;
  menu.style.zIndex = "10000";

  const list = document.createElement("div");
  list.className = "context-items";

  const item = document.createElement("div");
  item.className = "context-item";
  item.setAttribute("role", "menuitem");
  item.tabIndex = 0;
  item.textContent = String(label ?? "");
  const runAction = async (ev) => {
    try {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      ev?.stopImmediatePropagation?.();
    } catch (_) {
      // ignore
    }

    // Close immediately for responsiveness.
    closeStaOfficersLogContextMenu();
    try {
      await onClick?.();
    } catch (err) {
      console.error(`${MODULE_ID} | context menu action failed`, err);
    }
  };

  item.addEventListener("click", runAction);
  item.addEventListener("keydown", (ev) => {
    const k = String(ev?.key ?? "");
    if (k === "Enter" || k === " ") runAction(ev);
  });

  list.appendChild(item);
  menu.appendChild(list);
  document.body.appendChild(menu);

  // Clamp to viewport.
  try {
    const rect = menu.getBoundingClientRect();
    const pad = 4;
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    const clampedX = Math.min(Math.max(pad, Number(x) || 0), maxX);
    const clampedY = Math.min(Math.max(pad, Number(y) || 0), maxY);
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
  } catch (_) {
    // ignore
  }

  const onDocMouseDown = (ev) => {
    try {
      const t = ev?.target;
      if (t instanceof Node && menu.contains(t)) return;
    } catch (_) {
      // ignore
    }
    closeStaOfficersLogContextMenu();
  };

  const onKeyDown = (ev) => {
    try {
      if (String(ev?.key ?? "") === "Escape") closeStaOfficersLogContextMenu();
    } catch (_) {
      // ignore
    }
  };

  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  _staOpenContextMenuEl = menu;
  _staOpenContextMenuCleanup = () => {
    try {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    } catch (_) {
      // ignore
    }
  };
}
