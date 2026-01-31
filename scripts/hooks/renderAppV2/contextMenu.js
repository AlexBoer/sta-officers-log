import { MODULE_ID } from "../../core/constants.js";

/** @type {foundry.applications.ux.ContextMenu|null} */
let _staContextMenu = null;

/**
 * Close any currently open STA Officers Log context menu.
 */
export function closeStaOfficersLogContextMenu() {
  try {
    _staContextMenu?.close();
  } catch (_) {
    // ignore
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
  const menuItems = [
    {
      name: String(label ?? ""),
      icon: "",
      callback: async (target) => {
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
      },
    },
  ];

  _staContextMenu = new foundry.applications.ux.ContextMenu(
    container,
    selector,
    menuItems,
    { fixed: true },
  );
}
