/**
 * Label Values Button
 *
 * Adds a "Label Values" button to the Values section title,
 * allowing users to auto-generate descriptive icons for their values.
 */

import { t } from "../../core/i18n.js";
import { labelValuesOnActor } from "../../data/values.js";

/**
 * Install the "Label Values" button in the Values section title.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The application instance for re-rendering.
 */
export function installLabelValuesButton(root, actor, app) {
  const titleEl = root?.querySelector?.("div.section.values > div.title");
  if (!titleEl) return;

  // Add the "Label Values" button once.
  if (titleEl.querySelector(".sta-label-values-btn")) return;

  titleEl.classList.add("sta-values-title-with-button");

  const btn = document.createElement("a");
  btn.className = "sta-label-values-btn";
  btn.title = t("sta-officers-log.tools.labelValuesTooltip");
  btn.innerHTML = `${t(
    "sta-officers-log.tools.labelValues",
  )} <i class="fa-solid fa-tags"></i>`;

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await labelValuesOnActor(actor);
    app.render(); // refresh sheet to display new icons
  });

  titleEl.appendChild(btn);
}
