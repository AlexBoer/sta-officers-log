import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import {
  wasLogCreatedWithTrauma,
  setLogCreatedWithTraumaFlag,
} from "../../data/values.js";
import { syncMilestoneImgFromLog } from "../../data/milestoneIcons.js";
import { areTraumaRulesEnabled } from "../../settings/clientSettings.js";

// Module-level state: tracks whether the "Edit Log Data" <details> is open per log.
const _staLogMetaDetailsOpenByLogId = new Map(); // logId -> boolean

/**
 * Installs a collapsible "Edit Log Data" section on log item sheets.
 * Moves metadata fields into a <details> element and adds milestone association
 * and trauma checkbox controls.
 *
 * @param {HTMLElement} root - The root element of the item sheet
 * @param {Item} logItem - The log item being rendered
 */
export function installLogMetaCollapsible(root, logItem) {
  const itemSheet =
    root?.querySelector?.('.item-sheet[data-application-part="itemsheet"]') ||
    root?.querySelector?.(".item-sheet") ||
    null;
  if (!itemSheet) return;

  const logId = logItem?.id ? String(logItem.id) : "";

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
    // ignore
  }

  const details = document.createElement("details");
  details.className = "sta-callbacks-log-meta";
  // Preserve open/closed state across rerenders.
  if (logId) {
    details.open = _staLogMetaDetailsOpenByLogId.get(logId) === true;
    details.addEventListener("toggle", () => {
      try {
        _staLogMetaDetailsOpenByLogId.set(logId, details.open === true);
      } catch (_) {
        // ignore
      }
    });
  } else {
    details.open = false;
  }

  const summary = document.createElement("summary");
  summary.className = "sta-callbacks-log-meta-summary";
  summary.textContent = "Edit Log Data";
  details.appendChild(summary);

  // Manual callback milestone association (no sorting behavior, just metadata).
  try {
    const actor = logItem?.parent ?? logItem?.actor ?? null;
    if (actor?.items && actor.type === "character") {
      const milestones = Array.from(actor.items ?? [])
        .filter((i) => i?.type === "milestone")
        .sort((a, b) =>
          String(a.name ?? "").localeCompare(String(b.name ?? "")),
        );

      const existingLink = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
      const existingMilestoneId = existingLink?.milestoneId
        ? String(existingLink.milestoneId)
        : "";

      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("label");
      label.textContent = "Callback Milestone";

      const select = document.createElement("select");
      select.dataset.staCallbacksField = "callbackLinkMilestoneId";
      select.title =
        "Associate a Milestone/Arc with this log's callbackLink metadata";

      const none = document.createElement("option");
      none.value = "";
      none.textContent = "— None —";
      select.appendChild(none);

      for (const ms of milestones) {
        const opt = document.createElement("option");
        opt.value = String(ms.id);
        opt.textContent = String(ms.name ?? "").trim() || String(ms.id);
        select.appendChild(opt);
      }

      if (existingMilestoneId) select.value = existingMilestoneId;

      const onChange = async (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();

        const selectedId = String(select.value ?? "");
        try {
          const current = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
          const next = {
            ...(current && typeof current === "object" ? current : {}),
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
            if (selectedId) {
              const ms = actor.items.get(String(selectedId)) ?? null;
              if (ms?.type === "milestone") {
                await syncMilestoneImgFromLog(ms, logItem, {
                  setSourceFlag: true,
                });
              }
            }
          } catch (_) {
            // ignore
          }
        } catch (_) {
          // ignore
        }
      };

      select.addEventListener("change", onChange);

      row.appendChild(label);
      row.appendChild(select);
      details.appendChild(row);
    }
  } catch (_) {
    // ignore
  }

  // Checkbox to mark whether this log was created while its primary value was a trauma.
  // This flag persists so logs keep their V# or T# icon prefix even if the value's
  // trauma status later changes.
  // Only show if Trauma rules are enabled.
  if (areTraumaRulesEnabled()) {
    try {
      const createdWithTraumaRow = document.createElement("div");
      createdWithTraumaRow.className = "row sta-log-created-with-trauma-row";

      const traumaLabel = document.createElement("label");
      traumaLabel.textContent = t(
        "sta-officers-log.logSheet.createdWithTraumaLabel",
      );
      traumaLabel.title = t(
        "sta-officers-log.logSheet.createdWithTraumaTooltip",
      );

      const traumaCheckbox = document.createElement("input");
      traumaCheckbox.type = "checkbox";
      traumaCheckbox.dataset.staCallbacksField = "createdWithTrauma";
      traumaCheckbox.title = t(
        "sta-officers-log.logSheet.createdWithTraumaTooltip",
      );
      traumaCheckbox.checked = wasLogCreatedWithTrauma(logItem);

      const onTraumaChange = async (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();

        try {
          await setLogCreatedWithTraumaFlag(logItem, traumaCheckbox.checked);
        } catch (_) {
          // ignore
        }
      };

      traumaCheckbox.addEventListener("change", onTraumaChange);

      createdWithTraumaRow.appendChild(traumaLabel);
      createdWithTraumaRow.appendChild(traumaCheckbox);
      details.appendChild(createdWithTraumaRow);
    } catch (_) {
      // ignore
    }
  }

  try {
    itemSheet.insertBefore(details, descNote.nextSibling);
  } catch (_) {
    // ignore
  }

  for (const node of metaNodes) {
    try {
      details.appendChild(node);
    } catch (_) {
      // ignore
    }
  }
}
