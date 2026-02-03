import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import { isPlainObject } from "../../core/utils.js";
import {
  wasLogCreatedWithTrauma,
  setLogCreatedWithTraumaFlag,
  getLogIconPathForValue,
} from "../../data/values.js";
import { syncMilestoneImgFromLog } from "../../data/milestoneIcons.js";
import { areTraumaRulesEnabled } from "../../settings/clientSettings.js";

const LOG_META_TEMPLATE = `modules/${MODULE_ID}/templates/log-meta-collapsible.hbs`;

// Module-level state: tracks whether the "Edit Log Data" <details> is open per log.
const _staLogMetaDetailsOpenByLogId = new Map(); // logId -> boolean

/**
 * Prepares the template data for the log meta collapsible section.
 *
 * @param {Item} logItem - The log item being rendered
 * @returns {object} Template data for rendering
 */
function prepareLogMetaTemplateData(logItem) {
  const logId = logItem?.id ? String(logItem.id) : "";
  const isOpen = logId
    ? _staLogMetaDetailsOpenByLogId.get(logId) === true
    : false;

  const actor = logItem?.parent ?? logItem?.actor ?? null;
  const showMilestoneSelect = actor?.items && actor.type === "character";

  let milestones = [];
  let existingMilestoneId = "";

  if (showMilestoneSelect) {
    const existingLink = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
    existingMilestoneId = existingLink?.milestoneId
      ? String(existingLink.milestoneId)
      : "";

    milestones = actor.items
      .filter((i) => i?.type === "milestone")
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      .map((ms) => ({
        id: String(ms.id),
        name: String(ms.name ?? "").trim() || String(ms.id),
        selected: String(ms.id) === existingMilestoneId,
      }));
  }

  const showTraumaCheckbox = areTraumaRulesEnabled();

  // Read the showMilestoneArcButton flag from the log item (default false)
  let showMilestoneArcButton = false;
  try {
    const flag = logItem.getFlag?.(MODULE_ID, "showMilestoneArcButton");
    if (typeof flag === "boolean") showMilestoneArcButton = flag;
  } catch (_) {}

  // Read the custom date flag (stored as ISO date string YYYY-MM-DD)
  let customDate = "";
  try {
    const flag = logItem.getFlag?.(MODULE_ID, "customDate");
    if (flag && typeof flag === "string") customDate = flag;
  } catch (_) {}

  return {
    isOpen,
    showMilestoneSelect,
    milestones,
    showTraumaCheckbox,
    createdWithTrauma: showTraumaCheckbox
      ? wasLogCreatedWithTrauma(logItem)
      : false,
    traumaTooltip: showTraumaCheckbox
      ? t("sta-officers-log.logSheet.createdWithTraumaTooltip")
      : "",
    traumaLabel: showTraumaCheckbox
      ? t("sta-officers-log.logSheet.createdWithTraumaLabel")
      : "",
    showMilestoneArcButton,
    customDate,
  };
}

/**
 * Attaches event listeners to the rendered log meta collapsible section.
 *
 * @param {HTMLElement} details - The <details> element
 * @param {HTMLElement} itemSheet - The item sheet element
 * @param {Item} logItem - The log item being rendered
 */
function attachLogMetaEventListeners(details, itemSheet, logItem) {
  const logId = logItem?.id ? String(logItem.id) : "";
  const actor = logItem?.parent ?? logItem?.actor ?? null;

  // Track open/closed state across rerenders
  if (logId) {
    details.addEventListener("toggle", () => {
      try {
        _staLogMetaDetailsOpenByLogId.set(logId, details.open === true);
      } catch (_) {
        // state tracking is optional
      }
    });
  }

  // Milestone select change handler
  const milestoneSelect = details.querySelector(
    'select[data-sta-callbacks-field="callbackLinkMilestoneId"]',
  );
  if (milestoneSelect) {
    milestoneSelect.addEventListener("change", async (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();

      const selectedId = String(milestoneSelect.value ?? "");
      try {
        const current = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
        const next = {
          ...(isPlainObject(current) ? current : {}),
        };

        if (selectedId) next.milestoneId = selectedId;
        else delete next.milestoneId;

        await logItem.update(
          { [`flags.${MODULE_ID}.callbackLink`]: next },
          { renderSheet: false },
        );

        // If the user associates a Milestone/Arc with this log, keep the milestone icon
        // aligned with this log's icon (value icon).
        try {
          if (selectedId && actor?.items) {
            const ms = actor.items.get(String(selectedId)) ?? null;
            if (ms?.type === "milestone") {
              await syncMilestoneImgFromLog(ms, logItem, {
                setSourceFlag: true,
              });
            }
          }
        } catch (_) {
          // icon sync is cosmetic
        }
      } catch (_) {
        // flag update failed, possibly permissions
      }
    });
  }

  // Trauma checkbox change handler
  const traumaCheckbox = details.querySelector(
    'input[data-sta-callbacks-field="createdWithTrauma"]',
  );
  if (traumaCheckbox) {
    traumaCheckbox.addEventListener("change", async (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();

      try {
        await setLogCreatedWithTraumaFlag(logItem, traumaCheckbox.checked);

        // Update the log's icon to match the trauma status (V# or T#)
        const primaryValueId =
          logItem.getFlag?.(MODULE_ID, "primaryValueId") ?? "";
        if (primaryValueId && actor) {
          const newIcon = getLogIconPathForValue(
            actor,
            primaryValueId,
            traumaCheckbox.checked,
          );
          if (newIcon) {
            await logItem.update({ img: newIcon });
          }
        }
      } catch (_) {
        // flag update can fail if permissions changed
      }
    });
  }

  // Show milestone/arc button checkbox handler
  const showMilestoneArcCheckbox = details.querySelector(
    'input[data-sta-callbacks-field="showMilestoneArcButton"]',
  );
  if (showMilestoneArcCheckbox) {
    showMilestoneArcCheckbox.addEventListener("change", async (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      try {
        await logItem.setFlag(
          MODULE_ID,
          "showMilestoneArcButton",
          showMilestoneArcCheckbox.checked,
        );
        // Re-render the parent character sheet to update the log list UI
        const parentActor = logItem.parent ?? logItem.actor;
        if (parentActor && parentActor.sheet?.render) {
          parentActor.sheet.render();
        }
      } catch (_) {
        // flag update can fail if permissions changed
      }
    });
  }

  // Custom date input handler
  const customDateInput = details.querySelector(
    'input[data-sta-callbacks-field="customDate"]',
  );
  if (customDateInput) {
    customDateInput.addEventListener("change", async (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      try {
        const value = customDateInput.value?.trim() || "";
        if (value) {
          await logItem.setFlag(MODULE_ID, "customDate", value);
        } else {
          await logItem.unsetFlag(MODULE_ID, "customDate");
        }
      } catch (_) {
        // flag update can fail if permissions changed
      }
    });
  }

  // Clear custom date button handler
  const clearDateBtn = details.querySelector(
    'button[data-sta-callbacks-action="clearCustomDate"]',
  );
  if (clearDateBtn) {
    clearDateBtn.addEventListener("click", async (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      try {
        await logItem.unsetFlag(MODULE_ID, "customDate");
        if (customDateInput) customDateInput.value = "";
      } catch (_) {
        // flag update can fail if permissions changed
      }
    });
  }
}

/**
 * Installs a collapsible "Edit Log Data" section on log item sheets.
 * Moves metadata fields into a <details> element and adds milestone association
 * and trauma checkbox controls.
 *
 * @param {HTMLElement} root - The root element of the item sheet
 * @param {Item} logItem - The log item being rendered
 */
export async function installLogMetaCollapsible(root, logItem) {
  const itemSheet =
    root?.querySelector?.('.item-sheet[data-application-part="itemsheet"]') ||
    root?.querySelector?.(".item-sheet") ||
    null;
  if (!itemSheet) return;

  // Avoid double-wrapping on partial rerenders.
  if (itemSheet.querySelector(":scope .sta-callbacks-log-meta")) return;

  const nameInput = itemSheet.querySelector('input[name="name"]');
  if (!nameInput) return;
  const nameRow = nameInput.closest(".row") || null;
  if (!nameRow) return;

  // Description in STA uses a prose-mirror element.
  const descEditor =
    itemSheet.querySelector('prose-mirror[name="system.description"]') ||
    itemSheet.querySelector('textarea[name="system.description"]') ||
    itemSheet.querySelector('textarea[name="system.description.value"]') ||
    null;
  if (!descEditor) return;

  const descNote = descEditor.closest(".note") || descEditor.parentElement;
  if (!descNote) return;

  const descTitle =
    (descNote.previousElementSibling?.classList?.contains("title")
      ? descNote.previousElementSibling
      : null) || null;
  if (!descTitle) return;

  // Collect all nodes between Name row and Description title (metadata) and move them into <details>.
  const metaNodes = [];
  for (let node = nameRow.nextSibling; node && node !== descTitle; ) {
    const next = node.nextSibling;
    // Ignore pure-whitespace text nodes.
    if (node.nodeType === Node.TEXT_NODE) {
      if (!String(node.textContent ?? "").trim()) {
        node = next;
        continue;
      }
    }
    metaNodes.push(node);
    node = next;
  }

  // Move Description directly under the Name row.
  try {
    itemSheet.insertBefore(descTitle, nameRow.nextSibling);
    itemSheet.insertBefore(descNote, descTitle.nextSibling);
  } catch (_) {
    // DOM structure may differ across sheet versions
  }

  // Render the collapsible section from template
  const templateData = prepareLogMetaTemplateData(logItem);
  const html = await foundry.applications.handlebars.renderTemplate(
    LOG_META_TEMPLATE,
    templateData,
  );

  // Parse the HTML and get the details element
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const details = temp.querySelector("details");
  if (!details) return;

  // If milestone select exists in template, move it to the arc row if available
  const milestoneWrapper = details.querySelector(
    ".sta-milestone-select-wrapper",
  );
  if (milestoneWrapper) {
    const arcRow = itemSheet.querySelector(".sta-log-arc-row");
    if (arcRow) {
      arcRow.insertBefore(milestoneWrapper, arcRow.firstChild);
    }
  }

  // Attach event listeners
  attachLogMetaEventListeners(details, itemSheet, logItem);

  // Insert the details element into the DOM
  try {
    itemSheet.insertBefore(details, descNote.nextSibling);
  } catch (_) {
    // details insertion may fail if DOM changed
  }

  // Move collected metadata nodes into the details element
  for (const node of metaNodes) {
    try {
      details.appendChild(node);
    } catch (_) {
      // node may have been removed during iteration
    }
  }
}
