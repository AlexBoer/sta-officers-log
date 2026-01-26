/**
 * Benefit Labels
 *
 * Pure formatting function for milestone benefit results.
 * No dependencies on benefit application logic.
 */

import {
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
  SHIP_SYSTEM_LABELS,
  SHIP_DEPARTMENT_LABELS,
} from "./dialogs.js";

/**
 * Format a chosen benefit result into a human-readable label.
 * @param {Object} applied - The benefit result object
 * @returns {string} Formatted label for display
 */
export function formatChosenBenefitLabel(applied) {
  if (!applied || applied.applied !== true) return "";

  switch (applied.action) {
    case "attr":
      return `+1 ${ATTRIBUTE_LABELS[applied.key] ?? applied.key}`;
    case "disc":
      return `+1 ${DISCIPLINE_LABELS[applied.key] ?? applied.key}`;
    case "focus":
      return applied.name ? `Focus: ${applied.name}` : "New Focus";
    case "talent":
      return applied.name ? `Talent: ${applied.name}` : "New Talent";
    case "supporting":
      if (applied.supportingActorName && applied.supportingApplied?.applied) {
        const inner = formatChosenBenefitLabel(applied.supportingApplied);
        return inner
          ? `Supporting: ${applied.supportingActorName} — ${inner}`
          : `Supporting: ${applied.supportingActorName}`;
      }
      return "Supporting Character";
    case "shipSystemSwap":
      return `Ship Systems (-1/+1): ${
        SHIP_SYSTEM_LABELS[applied.dec] ?? applied.dec
      } → ${SHIP_SYSTEM_LABELS[applied.inc] ?? applied.inc}`;
    case "shipDepartmentSwap":
      return `Ship Departments (-1/+1): ${
        SHIP_DEPARTMENT_LABELS[applied.dec] ?? applied.dec
      } → ${SHIP_DEPARTMENT_LABELS[applied.inc] ?? applied.inc}`;
    case "shipTalentSwap":
      return applied.removed || applied.added
        ? `Ship Talent: ${applied.removed || "(remove)"} → ${
            applied.added || "(add)"
          }`
        : "Ship Talent (replaced)";
    case "shipManual":
      return "Ship Refit (ask GM)";

    case "arcAttr":
      return `+1 ${ATTRIBUTE_LABELS[applied.key] ?? applied.key}`;
    case "arcDisc":
      return `+1 ${DISCIPLINE_LABELS[applied.key] ?? applied.key}`;
    case "arcValue":
      return applied.name ? `Value: ${applied.name}` : "New Value";
    case "arcShipSystem":
      return `Ship System +1: ${
        SHIP_SYSTEM_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipSystemManual":
      return `Ship System +1 (ask GM): ${
        SHIP_SYSTEM_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipDepartment":
      return `Ship: +1 ${SHIP_DEPARTMENT_LABELS[applied.key] ?? applied.key}`;
    case "arcShipDepartmentManual":
      return `Ship Department +1 (ask GM to apply): ${
        SHIP_DEPARTMENT_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipTalent":
      return applied.name
        ? `New Ship Talent: ${applied.name}`
        : "New Ship Talent";
    case "arcShipTalentManual":
      return applied.name
        ? `New Ship Talent (ask GM to apply): ${applied.name}`
        : "New Ship Talent (ask GM to apply)";
    case "arcRemoveTrauma":
      return applied.newName
        ? `Remove Trauma: ${applied.newName}`
        : "Remove Trauma";
    default:
      return String(applied.action ?? "");
  }
}
