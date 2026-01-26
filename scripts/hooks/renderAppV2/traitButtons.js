/**
 * Trait Buttons (Scar & Fatigue)
 *
 * Adds per-trait buttons to the character sheet:
 * - "Use Scar" button for traits marked as scars
 * - "Choose Attribute" button for fatigue traits without an attribute chosen
 */

import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import { getModuleSocket } from "../../core/socket.js";
import { isTraitScar, isTraitFatigue } from "./itemFlags.js";
import {
  showAttributeSelectionDialog,
  hasFatiguedAttributeChosen,
} from "../stressHook.js";

/**
 * Install "Use Scar" buttons on trait entries that are marked as scars.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The application instance for re-rendering.
 */
export function installUseScarButtons(root, actor, app) {
  const traitEntries = root.querySelectorAll(
    'div.section.traits li.row.entry[data-item-type="trait"]',
  );

  for (const entry of traitEntries) {
    if (entry.querySelector(".sta-use-scar-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const traitItem = itemId ? actor.items.get(itemId) : null;
    if (!traitItem) continue;

    const isScar = isTraitScar(traitItem);
    if (!isScar) continue; // Only show button for scars

    // Locate the item-name input where we'll insert the button after
    const itemNameInput = entry.querySelector("input.item-name");
    if (!itemNameInput) continue;

    const useBtn = document.createElement("span");
    useBtn.className = "sta-use-scar-btn sta-inline-sheet-btn";
    useBtn.title = t("sta-officers-log.traits.useScarTooltip");
    useBtn.textContent = t("sta-officers-log.traits.useScar");
    useBtn.setAttribute("role", "button");
    useBtn.tabIndex = 0;

    // Check if scar has already been used
    const scarUsed = traitItem.getFlag?.(MODULE_ID, "isScarUsed");
    if (scarUsed) {
      useBtn.classList.add("is-disabled");
      useBtn.setAttribute("aria-disabled", "true");
      useBtn.disabled = true;
    }

    const onUseScar = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (scarUsed) return; // Don't allow clicking if already used

      const moduleSocket = getModuleSocket();
      if (!moduleSocket) {
        ui.notifications?.error(
          t("sta-officers-log.errors.socketNotAvailable"),
        );
        return;
      }

      useBtn.disabled = true;

      try {
        const result = await moduleSocket.executeAsGM(
          "requestScarUseApproval",
          {
            requestingUserId: game.user.id,
            actorUuid: actor.uuid,
            actorName: actor.name,
            traitItemId: traitItem.id,
            traitName: traitItem.name,
          },
        );

        if (result?.approved) {
          ui.notifications?.info(
            t("sta-officers-log.dialog.useValue.approved"),
          );
          // Mark scar as used
          await traitItem.setFlag(MODULE_ID, "isScarUsed", true);
          useBtn.classList.add("is-disabled");
          useBtn.setAttribute("aria-disabled", "true");
          useBtn.disabled = true;
        } else {
          ui.notifications?.warn(t("sta-officers-log.dialog.useValue.denied"));
          useBtn.disabled = false;
        }
      } catch (err) {
        console.error("sta-officers-log | Use Scar approval failed", err);
        ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
        useBtn.disabled = false;
      } finally {
        app.render();
      }
    };

    useBtn.addEventListener("click", onUseScar);
    useBtn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") onUseScar(ev);
    });

    // Insert button after item-name and before quantity
    itemNameInput.insertAdjacentElement("afterend", useBtn);
  }
}

/**
 * Install "Choose Attribute" buttons on fatigue traits that haven't had an attribute chosen.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The application instance for re-rendering.
 */
export function installChooseAttributeButtons(root, actor, app) {
  const traitEntries = root.querySelectorAll(
    'div.section.traits li.row.entry[data-item-type="trait"]',
  );

  for (const entry of traitEntries) {
    if (entry.querySelector(".sta-choose-attribute-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const traitItem = itemId ? actor.items.get(itemId) : null;
    if (!traitItem) continue;

    const isFatigue = isTraitFatigue(traitItem);
    if (!isFatigue) continue; // Only show button for fatigue traits

    // Only show button if attribute hasn't been chosen yet
    const attributeChosen = hasFatiguedAttributeChosen(traitItem, actor);
    if (attributeChosen) continue;

    // Locate the item-name input where we'll insert the button after
    const itemNameInput = entry.querySelector("input.item-name");
    if (!itemNameInput) continue;

    const chooseBtn = document.createElement("span");
    chooseBtn.className = "sta-choose-attribute-btn sta-inline-sheet-btn";
    chooseBtn.title = t("sta-officers-log.traits.chooseAttributeTooltip");
    chooseBtn.textContent = t("sta-officers-log.traits.chooseAttribute");
    chooseBtn.setAttribute("role", "button");
    chooseBtn.tabIndex = 0;

    const onChooseAttribute = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      chooseBtn.disabled = true;

      try {
        await showAttributeSelectionDialog(traitItem, actor);
        app.render();
      } catch (err) {
        console.error("sta-officers-log | Choose Attribute failed", err);
        chooseBtn.disabled = false;
      }
    };

    chooseBtn.addEventListener("click", onChooseAttribute);
    chooseBtn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") onChooseAttribute(ev);
    });

    // Insert button after item-name (and any existing scar button)
    const existingScarBtn = entry.querySelector(".sta-use-scar-btn");
    if (existingScarBtn) {
      existingScarBtn.insertAdjacentElement("afterend", chooseBtn);
    } else {
      itemNameInput.insertAdjacentElement("afterend", chooseBtn);
    }
  }
}
