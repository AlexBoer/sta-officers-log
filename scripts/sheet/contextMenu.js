import { MODULE_ID } from "../core/constants.js";

/** @type {foundry.applications.ux.ContextMenu|null} */
let _staContextMenu = null;

/**
 * Close any currently open STA Officers Log context menu.
 */
export function closeStaOfficersLogContextMenu() {
  try {
    // Only attempt to close if the menu exists and has a valid element
    if (_staContextMenu?.element) {
      _staContextMenu.close();
    }
  } catch (_) {
    // ignore
  } finally {
    _staContextMenu = null;
  }
}

/**
 * Set up a context menu for mission log rows.
 * Uses Foundry's declarative ContextMenu API.
 *
 * @param {Object} options
 * @param {HTMLElement} options.container - The container element to watch for right-clicks.
 * @param {string} options.selector - CSS selector for elements that should trigger the menu.
 * @param {string} options.label - The label text for the menu item.
 * @param {(element: HTMLElement) => Promise<void>} options.onSelect - Callback when the item is selected, receives the clicked element.
 */
export function setupMissionLogContextMenu({
  container,
  selector,
  label,
  onSelect,
}) {
  if (!(container instanceof HTMLElement)) return;

  // Close any existing menu first
  closeStaOfficersLogContextMenu();

  /** @type {ContextMenuEntry[]} */
  const handleSelect = async (target) => {
    try {
      // target is the element that was right-clicked (matches the selector)
      const element =
        target instanceof HTMLElement
          ? target
          : target?.[0] instanceof HTMLElement
            ? target[0]
            : null;
      if (element) {
        await onSelect?.(element);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | context menu action failed`, err);
    }
  };
  const menuItems = [
    game.release.generation >= 14
      ? {
          label: String(label ?? ""),
          icon: "",
          onClick: (_event, target) => handleSelect(target),
        }
      : {
          name: String(label ?? ""),
          icon: "",
          callback: handleSelect,
        },
  ];

  _staContextMenu = new foundry.applications.ux.ContextMenu(
    container,
    selector,
    menuItems,
    { fixed: true, jQuery: false },
  );

  container.querySelectorAll(selector).forEach((row) => {
    row.querySelector(".sta-officers-log-row-menu")?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sta-officers-log-row-menu";
    button.title = game.i18n.localize("sta-officers-log.logs.moreActions");
    button.setAttribute("aria-label", button.title);
    button.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = button.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: event.clientX || bounds.right,
          clientY: event.clientY || bounds.bottom,
        }),
      );
    });
    row.appendChild(button);
  });
}
