import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  DIRECTIVE_MAX_LEN,
  getMissionDirectives,
  setMissionDirectives,
} from "../directives/directives.js";
import { setupMissionLogContextMenu } from "../sheet/contextMenu.js";

const TRACKER_BUTTONS_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-buttons.hbs`;
const TRACKER_DIRECTIVES_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-directives.hbs`;
const TRACKER_MOMENTUM_INFO_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-momentum-info.hbs`;
const TRACKER_THREAT_INFO_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-threat-info.hbs`;

const TRACKER_INFO_CONFIG = [
  {
    label: "Momentum",
    key: "momentum",
    title: "Momentum",
    template: TRACKER_MOMENTUM_INFO_TEMPLATE,
  },
  {
    label: "Threat",
    key: "threat",
    title: "Threat",
    template: TRACKER_THREAT_INFO_TEMPLATE,
  },
];

/**
 * Install Officers Log buttons in the STA Tracker panel.
 * GM-only feature that adds buttons for callback prompts, new mission, and new scene.
 */
export async function installOfficersLogButtonsInStaTracker(app, root) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!game.user?.isGM) return;
    if (!game.staofficerslog) return;

    // Detect the STA system tracker.
    const ctorName = String(app?.constructor?.name ?? "");
    const looksLikeTracker =
      ctorName === "STATracker" ||
      !!root.querySelector?.(".tracker-container") ||
      !!root.querySelector?.("#sta-roll-task-button") ||
      !!root.querySelector?.("#sta-momentum-tracker");

    if (!looksLikeTracker) return;

    // Avoid duplicates across rerenders.
    if (root.querySelector?.(".sta-officers-log-group")) return;

    // Insert next to the existing roll buttons column.
    const row =
      root.querySelector?.(".tracker-container .row") ??
      root.querySelector?.(".row") ??
      null;
    if (!row) return;

    const iconContainer = row.querySelector?.(":scope > .icon-container");
    if (!iconContainer) return;

    // Wrap the existing STA tracker buttons and our module buttons into a 2-column layout.
    let columns = iconContainer.querySelector?.(
      ":scope > .sta-tracker-button-columns",
    );
    let systemGroup = iconContainer.querySelector?.(
      ":scope > .sta-tracker-button-columns > .sta-tracker-button-group.sta-tracker-system-buttons",
    );

    if (!columns || !systemGroup) {
      columns = document.createElement("div");
      columns.className = "sta-tracker-button-columns";

      systemGroup = document.createElement("div");
      systemGroup.className =
        "sta-tracker-button-group sta-tracker-system-buttons";

      // Move existing buttons into the system group.
      const children = Array.from(iconContainer.children);
      for (const child of children) systemGroup.appendChild(child);

      // Replace iconContainer contents with the columns wrapper.
      iconContainer.innerHTML = "";
      columns.appendChild(systemGroup);
      iconContainer.appendChild(columns);
    }

    // Render buttons from template
    const buttonsHtml = await foundry.applications.handlebars.renderTemplate(
      TRACKER_BUTTONS_TEMPLATE,
      {
        moduleId: MODULE_ID,
      },
    );
    columns.insertAdjacentHTML("beforeend", buttonsHtml);

    // Attach event listeners to the rendered buttons
    const officersGroup = columns.querySelector(".sta-officers-log-group");
    if (officersGroup) {
      officersGroup.addEventListener("click", (event) => {
        const btn = event.target?.closest?.("[data-action]");
        if (!btn) return;

        try {
          event?.preventDefault?.();
          event?.stopPropagation?.();
        } catch (_) {
          // event may be synthetic
        }

        const action = btn.dataset.action;
        try {
          if (action === "openCallback") {
            game.staofficerslog.open();
          } else if (action === "resetMission") {
            game.staofficerslog.promptNewMissionAndReset();
          } else if (action === "newScene") {
            game.staofficerslog.newScene();
          }
        } catch (err) {
          console.error(`${MODULE_ID} | tracker button failed`, err);
        }
      });
    }
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

    // Measure current height before adding the section.
    const heightBefore = trackerContainer.offsetHeight;

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
    const textarea = section.querySelector(".sta-tracker-directives-textarea");

    editButton?.addEventListener("click", () => {
      toggleDirectivesEditMode(section, trackerContainer, root);
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

    // After adding the section, use negative margin-top to shift the tracker up.
    // The STA system continuously resets the inline `top` style, but margin-top
    // via CSS should persist and effectively move the tracker upward.
    // We use multiple animation frames to account for text wrapping and layout shifts.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          const sectionHeight = section?.offsetHeight ?? 0;

          if (sectionHeight > 0) {
            // Apply negative margin to the outermost app element to shift it up.
            // This works even when the STA system resets the `top` style.
            const appElement = root.closest?.("[id^='app-']") ?? root;
            if (appElement instanceof HTMLElement) {
              appElement.style.marginTop = `-${sectionHeight}px`;
            }
          }
        } catch (_) {
          // margin tweak is cosmetic
        }
      });
    });
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
            const content = config.template
              ? await foundry.applications.handlebars.renderTemplate(
                  config.template,
                  {},
                )
              : config.body;

            await foundry.applications.api.DialogV2.wait({
              window: { title: config.title },
              content: content ?? "",
              render: (_event, dialog) => {
                try {
                  const html = dialog?.element;
                  if (!(html instanceof HTMLElement)) return;

                  setupMissionLogContextMenu({
                    container: html,
                    selector: ".row",
                    label: "Send to Chat",
                    onSelect: async (row) => {
                      const chatContent = buildCheatsheetRowChatContent(
                        row,
                        config.title,
                      );
                      if (!chatContent) return;

                      await ChatMessage.create({
                        content: chatContent,
                        speaker: ChatMessage.getSpeaker(),
                      });
                    },
                  });
                } catch (err) {
                  console.error(
                    `${MODULE_ID} | tracker info context menu failed`,
                    err,
                  );
                }
              },
              buttons: [
                {
                  action: "ok",
                  label: "OK",
                  default: true,
                },
              ],
              rejectClose: false,
              modal: false,
            });
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

  // Recalculate margin-top after switching modes, since the edit mode
  // (especially with 0 directives) can be significantly taller than display mode.
  // Use multiple animation frames to ensure layout has settled.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const appElement = root.closest?.("[id^='app-']") ?? root;
        if (!(appElement instanceof HTMLElement)) return;

        const sectionHeight = section?.offsetHeight ?? 0;

        if (sectionHeight > 0) {
          appElement.style.marginTop = `-${sectionHeight}px`;
        } else {
          appElement.style.marginTop = "";
        }
      } catch (_) {
        // ignore
      }
    });
  });
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

/**
 * Build chat HTML for a cheatsheet row.
 *
 * @param {HTMLElement} row - Row element containing a cheatsheet entry.
 * @param {string} dialogTitle - The dialog title (Momentum/Threat).
 * @returns {string|null} HTML string or null if row is not a cheatsheet entry.
 */
function buildCheatsheetRowChatContent(row, dialogTitle) {
  if (!(row instanceof HTMLElement)) return null;

  const titleEl = row.querySelector(".tracktitle");
  if (!titleEl) return null;

  const titleText = String(titleEl.textContent ?? "").trim();
  if (!titleText) return null;

  const valueEl = row.querySelector(".column.value");
  const valueText = String(valueEl?.textContent ?? "").trim();
  const tooltipText = String(titleEl.getAttribute("title") ?? "").trim();

  const escape = foundry.utils?.escapeHTML ?? ((s) => s);
  const safeTitle = escape(titleText);
  const safeValue = valueText ? escape(valueText) : "";
  const safeTooltip = tooltipText ? escape(tooltipText) : "";
  const safeDialogTitle = dialogTitle ? escape(dialogTitle) : "";

  const valueSuffix = safeValue ? ` — ${safeValue}` : "";
  const tooltipHtml = safeTooltip
    ? `<div class="hint">${safeTooltip}</div>`
    : "";
  const headerHtml = safeDialogTitle
    ? `<div class="sta-cheatsheet-chat-title">${safeDialogTitle}</div>`
    : "";

  return `
    <div class="sta-cheatsheet-chat">
      ${headerHtml}
      <div><strong>${safeTitle}</strong>${valueSuffix}</div>
      ${tooltipHtml}
    </div>
  `;
}
