import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  DIRECTIVE_MAX_LEN,
  getMissionDirectives,
  setMissionDirectives,
} from "../directives/directives.js";
import { promptUseDirective } from "../directives/useDirectiveButton.js";
import { hasActiveMission } from "../missions/mission.js";
import { MissionManagerApp } from "../missions/MissionManagerApp.mjs";

const TRACKER_BUTTONS_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-buttons.hbs`;
const TRACKER_DIRECTIVES_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-directives.hbs`;

const TRACKER_INFO_CONFIG = [
  {
    label: "Momentum",
    key: "momentum",
    title: "Momentum",
  },
  {
    label: "Threat",
    key: "threat",
    title: "Threat",
  },
];

/**
 * Open the Manage Missions dialog (ApplicationV2 with history list).
 */
function _manageMissions() {
  new MissionManagerApp().render(true);
}

/**
 * Install Officers Log buttons in the STA Tracker panel.
 * GM-only feature that adds buttons for conflict reference, mission manager, and roll request.
 */
export async function installOfficersLogButtonsInStaTracker(app, root) {
  try {
    // Tracker button injection has been moved to sta-utils.
    // Officers Log still exposes the API and tracker dialogs, but does not
    // own the tracker button layout anymore.
    void app;
    void root;
  } catch (_) {
    // tracker integration is optional
  }
}

/**
 * Install the Mission Directives section in the STA Tracker.
 * Shows current directives with edit capability for GMs.
 *
 * @param {HTMLElement} root - The root element to search for the tracker container.
 */
export async function installMissionDirectivesInStaTracker(root) {
  try {
    if (!(root instanceof HTMLElement)) return;

    const directives = getMissionDirectives();

    // Find the tracker container to append to.
    const trackerContainer =
      root.querySelector?.(".tracker-container[data-application-part]") ??
      root.querySelector?.(".tracker-container") ??
      null;
    if (!trackerContainer) return;

    // Remove any existing section so we always rebuild with fresh data.
    // This ensures the directives list updates when directives are edited.
    const existingSection = trackerContainer.querySelector?.(
      ".sta-tracker-directives-section",
    );
    if (existingSection) {
      existingSection.remove();
    }

    // Render the directives section from template
    const html = await foundry.applications.handlebars.renderTemplate(
      TRACKER_DIRECTIVES_TEMPLATE,
      {
        isGM: game.user?.isGM ?? false,
        directives,
        hasDirectives: directives.length > 0,
        directivesText: directives.join("\n"),
      },
    );

    // Parse the HTML and append to get a direct reference to the section
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const section = temp.firstElementChild;
    if (!section) return;
    trackerContainer.appendChild(section);

    // Attach event listeners
    const editButton = section.querySelector('[data-action="toggleEdit"]');
    const saveButton = section.querySelector('[data-action="saveDirectives"]');
    const useDirectiveButton = section.querySelector(
      '[data-action="useDirective"]',
    );
    const textarea = section.querySelector(".sta-tracker-directives-textarea");

    editButton?.addEventListener("click", () => {
      toggleDirectivesEditMode(section, trackerContainer, root);
    });

    // "Use Directive" button – resolve the user's character and invoke the flow.
    useDirectiveButton?.addEventListener("click", async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (_) {
        // event may be synthetic
      }

      const actor = game.user?.character ?? null;
      if (!actor) {
        ui.notifications?.warn?.(t("sta-officers-log.errors.noCharacter"));
        return;
      }

      await promptUseDirective(actor);
    });

    // Prevent input that would exceed the max character limit per line.
    textarea?.addEventListener("keydown", (event) => {
      // Always allow: Enter, Backspace, Delete, arrow keys, and modifier combos.
      if (
        event.key === "Enter" ||
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key.startsWith("Arrow") ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      // For printable characters, check if the current line would exceed the limit.
      if (event.key.length === 1) {
        const lines = textarea.value.split("\n");
        const cursorPos = textarea.selectionStart;

        // Find which line the cursor is on.
        let charCount = 0;
        let currentLineIndex = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineEnd = charCount + lines[i].length;
          if (cursorPos <= lineEnd) {
            currentLineIndex = i;
            break;
          }
          charCount += lines[i].length + 1; // +1 for newline
        }

        const currentLine = lines[currentLineIndex] || "";

        // Block input if this line is already at the max length.
        if (currentLine.length >= DIRECTIVE_MAX_LEN) {
          event.preventDefault();
        }
      }
    });

    saveButton?.addEventListener("click", async () => {
      if (!textarea) return;

      const newDirectives = textarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setMissionDirectives(newDirectives);
      // Rebuild the section with fresh data.
      await installMissionDirectivesInStaTracker(root);

      // Notify other connected clients to refresh their tracker so
      // the updated directives appear for everyone.
      try {
        const { getModuleSocket } = await import("../core/socket.js");
        const sock = getModuleSocket();
        if (sock) await sock.executeForOthers("refreshTracker");
      } catch (_) {
        // socket broadcast is best-effort
      }
    });

    // The section is positioned with CSS `position: absolute; bottom: 100%`
    // relative to the app element (the nearest positioned ancestor), so it
    // floats above the tracker and expands upward — no JS positioning needed.
  } catch (_) {
    // directives section is optional
  }
}

/**
 * Install info buttons next to Momentum and Threat labels in the STA Tracker.
 *
 * @param {HTMLElement} root - The root element to search for the tracker container.
 */
export function installTrackerInfoButtonsInStaTracker(root) {
  try {
    if (!(root instanceof HTMLElement)) return;

    const trackerContainer =
      root.querySelector?.(".tracker-container[data-application-part]") ??
      root.querySelector?.(".tracker-container") ??
      null;
    if (!trackerContainer) return;

    for (const config of TRACKER_INFO_CONFIG) {
      const parents = findTrackerLabelParents(trackerContainer, config.label);
      for (const parent of parents) {
        if (!parent || !(parent instanceof HTMLElement)) continue;

        if (
          parent.querySelector?.(
            `.sta-officers-log-info-btn[data-info="${config.key}"]`,
          )
        ) {
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "sta-officers-log-info-btn";
        button.dataset.info = config.key;
        button.title = `${config.title} info`;
        button.setAttribute("aria-label", `${config.title} info`);
        button.innerHTML = '<i class="fas fa-info-circle"></i>';

        button.addEventListener("click", async (event) => {
          try {
            event?.preventDefault?.();
            event?.stopPropagation?.();
          } catch (_) {
            // ignore synthetic event
          }

          try {
            const openReference = game.staUtils?.trackerReference;
            if (typeof openReference !== "function") {
              ui.notifications?.warn?.(
                "STA-Utils tracker reference dialogs are unavailable.",
              );
              return;
            }
            await openReference(config.key);
          } catch (err) {
            console.error(`${MODULE_ID} | tracker info dialog failed`, err);
          }
        });

        parent.appendChild(button);
      }
    }
  } catch (_) {
    // info buttons are optional
  }
}

/**
 * Toggle between display and edit mode for the directives section.
 */
function toggleDirectivesEditMode(section, trackerContainer, root) {
  const displayContainer = section.querySelector(
    ".sta-tracker-directives-display",
  );
  const editContainer = section.querySelector(".sta-tracker-directives-edit");
  const editButton = section.querySelector(".sta-tracker-directives-edit-btn");

  if (!displayContainer || !editContainer) return;

  const isEditing = editContainer.style.display !== "none";

  if (isEditing) {
    // Switch to display mode.
    displayContainer.style.display = "";
    editContainer.style.display = "none";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.title = t("sta-officers-log.tracker.editDirectives");
    }
  } else {
    // Switch to edit mode.
    displayContainer.style.display = "none";
    editContainer.style.display = "";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-times"></i>';
      editButton.title = t("sta-officers-log.tracker.cancelEdit");
    }
    // Focus the textarea.
    const textarea = editContainer.querySelector("textarea");
    if (textarea) {
      textarea.focus();
    }
  }
}

/**
 * Find parent elements that contain a text node matching the target label.
 *
 * @param {HTMLElement} root - Root element to search within.
 * @param {string} label - Exact label to match.
 * @returns {HTMLElement[]} Parent elements containing matching text nodes.
 */
function findTrackerLabelParents(root, label) {
  const matches = new Set();
  const target = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!target) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = String(node?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return text === target
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent) matches.add(parent);
    current = walker.nextNode();
  }

  return Array.from(matches);
}
