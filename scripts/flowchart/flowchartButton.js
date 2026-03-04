/**
 * Flowchart Button Hook
 *
 * Installs a button in the Character Logs section title that opens
 * the MissionFlowchartApp when the flowchart view setting is enabled.
 *
 * @module sheetHooks/renderAppV2/flowchartButton
 */

import { isFlowchartViewEnabled } from "../settings/clientSettings.js";
import { MissionFlowchartApp } from "./MissionFlowchartApp.js";

const BTN_CLASS = "sta-flowchart-btn";

/**
 * Install the flowchart button in the Character Logs section.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor being displayed.
 */
export function installFlowchartButton(root, actor) {
  if (!isFlowchartViewEnabled()) return;
  if (!root || !actor) return;

  // Find the logs section by locating a log entry and getting its parent section.
  // The mobile sheet uses div.section.character-log; the standard sheet uses
  // div.section.milestones for both logs and milestones.
  const anyLogEntry =
    root?.querySelector?.(
      'div.section.character-log li.row.entry[data-item-type="log"]',
    ) ??
    root?.querySelector?.(
      'div.section.milestones li.row.entry[data-item-type="log"]',
    );
  const logsSection = anyLogEntry?.closest?.("div.section") ?? null;

  // If no logs exist, try to find by section title text
  const titleEl = logsSection
    ? logsSection.querySelector(":scope > div.title") ||
      logsSection.querySelector("div.title")
    : _findLogsSectionTitle(root);

  if (!titleEl) return;

  // Don't add duplicate buttons
  if (titleEl.querySelector(`.${BTN_CLASS}`)) return;

  // Create the flowchart button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BTN_CLASS;
  btn.title = game.i18n.localize("sta-officers-log.flowchart.title");
  btn.innerHTML = '<i class="fas fa-project-diagram"></i>';

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    _openFlowchart(actor);
  });

  // Insert the button in the title, after existing content
  titleEl.appendChild(btn);
}

/**
 * Try to find the logs section title by looking for title elements.
 * This is a fallback when there are no log entries.
 *
 * @param {HTMLElement} root - The root element.
 * @returns {HTMLElement|null} The title element, or null.
 */
function _findLogsSectionTitle(root) {
  // Look for section titles and check for "Logs" text
  const titles = root.querySelectorAll("div.section div.title");
  for (const title of titles) {
    const text = title.textContent?.toLowerCase() || "";
    if (text.includes("log") || text.includes("mission")) {
      return title;
    }
  }
  return null;
}

/**
 * Open the flowchart app for the given actor.
 *
 * @param {Actor} actor - The actor to display the flowchart for.
 */
function _openFlowchart(actor) {
  // Check if there's already an open flowchart for this actor
  const existingApp = Object.values(ui.windows).find(
    (w) => w instanceof MissionFlowchartApp && w.actor?.id === actor.id,
  );

  if (existingApp) {
    existingApp.bringToFront();
    return;
  }

  // Create and render a new flowchart app
  const app = new MissionFlowchartApp(actor);
  app.render(true);
}
