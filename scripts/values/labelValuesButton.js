/**
 * Label Values Context Menu
 *
 * Adds a right-click context menu to the Values section title bar,
 * allowing users to auto-generate descriptive icons for their values.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { labelValuesOnActor } from "./values.js";

/**
 * Install a right-click context menu on the Values section title
 * providing the "Label Values" action.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The application instance for re-rendering.
 */
export function installLabelValuesButton(root, actor, app) {
  const valuesSection = root?.querySelector?.("div.section.values");
  if (!valuesSection) return;

  const titleEl = valuesSection.querySelector(":scope > div.title");
  if (!titleEl) return;

  // Only install once per render.
  if (titleEl.dataset.staLabelValuesMenu) return;
  titleEl.dataset.staLabelValuesMenu = "1";

  // Ensure the title has a recognizable class for the context menu selector.
  titleEl.classList.add("sta-values-title-with-button");

  /** @type {ContextMenuEntry[]} */
  const menuItems = [
    {
      name: `${t("sta-officers-log.tools.labelValues")}`,
      icon: '<i class="fa-solid fa-tags"></i>',
      callback: async () => {
        try {
          await labelValuesOnActor(actor);
          app.render();
        } catch (err) {
          console.error(
            `${MODULE_ID} | Label Values context menu action failed`,
            err,
          );
        }
      },
    },
  ];

  new foundry.applications.ux.ContextMenu(
    valuesSection,
    ".sta-values-title-with-button",
    menuItems,
    { fixed: true, jQuery: false },
  );
}
