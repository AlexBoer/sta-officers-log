import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import {
  getMissionDirectives,
  setMissionDirectives,
} from "../../data/directives.js";

/**
 * Install Officers Log buttons in the STA Tracker panel.
 * GM-only feature that adds buttons for callback prompts, new mission, and new scene.
 */
export function installOfficersLogButtonsInStaTracker(app, root) {
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

    const makeButton = ({ id, cls, title, icon, onClick }) => {
      const btn = document.createElement("div");
      btn.id = id;
      btn.className = `button ${cls}`;
      btn.title = title;
      btn.dataset.action = "staOfficersLog";

      const i = document.createElement("i");
      // Use fixed-width icons so the column aligns cleanly with the STA buttons.
      i.className = `${icon} fa-fw`;
      btn.appendChild(i);

      btn.addEventListener("click", (event) => {
        try {
          event?.preventDefault?.();
          event?.stopPropagation?.();
        } catch (_) {
          // ignore
        }

        try {
          onClick?.();
        } catch (err) {
          console.error(`${MODULE_ID} | tracker button failed`, err);
        }
      });

      return btn;
    };

    const divider = document.createElement("div");
    divider.className = "sta-tracker-button-divider sta-officers-log-divider";

    const officersGroup = document.createElement("div");
    officersGroup.className = "sta-tracker-button-group sta-officers-log-group";
    officersGroup.dataset.module = MODULE_ID;

    // Mirror the Scene Controls actions.
    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-open-button",
        cls: "sta-officers-log-open",
        title: t("sta-officers-log.tools.sendPrompt"),
        icon: "fa-solid fa-reply",
        onClick: () => game.staCallbacksHelper.open(),
      }),
    );

    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-reset-button",
        cls: "sta-officers-log-reset",
        title: t("sta-officers-log.tools.resetMission"),
        icon: "fa-solid fa-book",
        onClick: () => game.staCallbacksHelper.promptNewMissionAndReset(),
      }),
    );

    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-new-scene-button",
        cls: "sta-officers-log-new-scene",
        title: t("sta-officers-log.tools.newScene"),
        icon: "fa-solid fa-clapperboard",
        onClick: () => game.staCallbacksHelper.newScene(),
      }),
    );

    columns.appendChild(divider);
    columns.appendChild(officersGroup);

    // --- Mission Directives Section ---
    installMissionDirectivesInStaTracker(root, row);
  } catch (_) {
    // ignore
  }
}

/**
 * Install the Mission Directives section in the STA Tracker.
 * Shows current directives with edit capability for GMs.
 *
 * @param {HTMLElement} root - The root element to search for the tracker container.
 */
export function installMissionDirectivesInStaTracker(root) {
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

    // Create the directives section.
    const section = document.createElement("div");
    section.className = "sta-tracker-directives-section";

    const header = document.createElement("div");
    header.className = "sta-tracker-directives-header";

    const headerText = document.createElement("span");
    headerText.textContent = t("sta-officers-log.tracker.missionDirectives");
    header.appendChild(headerText);

    // Add edit button for GM only.
    if (game.user?.isGM) {
      const editButton = document.createElement("button");
      editButton.className = "sta-tracker-directives-edit-btn";
      editButton.type = "button";
      editButton.title = t("sta-officers-log.tracker.editDirectives");
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener("click", () => {
        toggleDirectivesEditMode(section, trackerContainer, root);
      });
      header.appendChild(editButton);
    }

    section.appendChild(header);

    // Create display mode content.
    const displayContainer = document.createElement("div");
    displayContainer.className = "sta-tracker-directives-display";

    const list = document.createElement("ul");
    list.className = "sta-tracker-directives-list";

    if (directives.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className =
        "sta-tracker-directive-item sta-tracker-directive-empty";
      emptyItem.textContent = t("sta-officers-log.tracker.noDirectives");
      list.appendChild(emptyItem);
    } else {
      for (const directive of directives) {
        const item = document.createElement("li");
        item.className = "sta-tracker-directive-item";
        item.textContent = directive;
        list.appendChild(item);
      }
    }

    displayContainer.appendChild(list);
    section.appendChild(displayContainer);

    // Create edit mode content (hidden by default).
    const editContainer = document.createElement("div");
    editContainer.className = "sta-tracker-directives-edit";
    editContainer.style.display = "none";

    const textarea = document.createElement("textarea");
    textarea.className = "sta-tracker-directives-textarea";
    textarea.placeholder = t("sta-officers-log.tracker.directivesPlaceholder");
    textarea.value = directives.join("\n");
    editContainer.appendChild(textarea);

    const saveButton = document.createElement("button");
    saveButton.className = "sta-tracker-directives-save-btn";
    saveButton.type = "button";
    saveButton.textContent = t("sta-officers-log.tracker.save");
    saveButton.addEventListener("click", async () => {
      const newDirectives = textarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setMissionDirectives(newDirectives);
      // Rebuild the section with fresh data.
      installMissionDirectivesInStaTracker(root, row);
    });
    editContainer.appendChild(saveButton);

    section.appendChild(editContainer);
    trackerContainer.appendChild(section);

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
        // ignore
      }
    });
  } catch (_) {
    // ignore
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
