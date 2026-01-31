import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import {
  getMissionDirectives,
  setMissionDirectives,
} from "../../data/directives.js";

const TRACKER_BUTTONS_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-buttons.hbs`;
const TRACKER_DIRECTIVES_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-directives.hbs`;

/**
 * Install Officers Log buttons in the STA Tracker panel.
 * GM-only feature that adds buttons for callback prompts, new mission, and new scene.
 */
export async function installOfficersLogButtonsInStaTracker(app, root) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!game.user?.isGM) return;
    if (!game.staCallbacksHelper) return;

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
    const buttonsHtml = await renderTemplate(TRACKER_BUTTONS_TEMPLATE, {
      moduleId: MODULE_ID,
    });
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
            game.staCallbacksHelper.open();
          } else if (action === "resetMission") {
            game.staCallbacksHelper.promptNewMissionAndReset();
          } else if (action === "newScene") {
            game.staCallbacksHelper.newScene();
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
    const html = await renderTemplate(TRACKER_DIRECTIVES_TEMPLATE, {
      isGM: game.user?.isGM ?? false,
      directives,
      hasDirectives: directives.length > 0,
      directivesText: directives.join("\n"),
    });

    // Parse the HTML and append to get a direct reference to the section
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const section = temp.firstElementChild;
    if (!section) return;
    trackerContainer.appendChild(section);

    // Attach event listeners
    const editButton = section.querySelector('[data-action="toggleEdit"]');
    const saveButton = section.querySelector('[data-action="saveDirectives"]');

    editButton?.addEventListener("click", () => {
      toggleDirectivesEditMode(section, trackerContainer, root);
    });

    saveButton?.addEventListener("click", async () => {
      const textarea = section.querySelector(
        ".sta-tracker-directives-textarea",
      );
      if (!textarea) return;

      const newDirectives = textarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setMissionDirectives(newDirectives);
      // Rebuild the section with fresh data.
      await installMissionDirectivesInStaTracker(root);
    });

    // After adding the section, use negative margin-top to shift the tracker up.
    // The STA system continuously resets the inline `top` style, but margin-top
    // via CSS should persist and effectively move the tracker upward.
    requestAnimationFrame(() => {
      try {
        const heightAfter = trackerContainer.offsetHeight;
        const heightDiff = heightAfter - heightBefore;

        if (heightDiff > 0) {
          // Apply negative margin to the outermost app element to shift it up.
          // This works even when the STA system resets the `top` style.
          const appElement = root.closest?.("[id^='app-']") ?? root;
          if (appElement instanceof HTMLElement) {
            appElement.style.marginTop = `-${heightDiff}px`;
          }
        }
      } catch (_) {
        // margin tweak is cosmetic
      }
    });
  } catch (_) {
    // directives section is optional
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
  requestAnimationFrame(() => {
    try {
      const appElement = root.closest?.("[id^='app-']") ?? root;
      if (!(appElement instanceof HTMLElement)) return;
      if (!(trackerContainer instanceof HTMLElement)) return;

      // Temporarily remove margin-top to measure the "base" height
      // (i.e., the tracker without our margin adjustment).
      const previousMargin = appElement.style.marginTop || "";
      appElement.style.marginTop = "";

      // The directives section is now rendered; measure its contribution.
      const sectionHeight = section?.offsetHeight ?? 0;

      if (sectionHeight > 0) {
        appElement.style.marginTop = `-${sectionHeight}px`;
      } else {
        appElement.style.marginTop = previousMargin;
      }
    } catch (_) {
      // ignore
    }
  });
}
