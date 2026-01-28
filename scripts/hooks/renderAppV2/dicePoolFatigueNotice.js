/**
 * Dice Pool Fatigue Notice
 *
 * Adds a fatigue warning notice to dice pool dialogs when the character has a
 * fatigue trait, informing the player that they have +1 Difficulty.
 */

import { isTraitFatigue } from "./itemFlags.js";

/**
 * Install a fatigue notice in dice pool dialogs when the character is fatigued.
 *
 * @param {Application} app - The application being rendered.
 * @param {HTMLElement} root - The root element of the application.
 * @param {Object} _context - The render context.
 */
export function installDicePoolFatigueNotice(app, root, _context) {
  const isDicePoolDialog =
    root?.querySelector?.("#dice-pool-form") ||
    root?.querySelector?.('[id*="dice-pool"]') ||
    app?.window?.title === "Dice Pool";

  if (!isDicePoolDialog) return;

  // Get the actor directly associated with this dice pool dialog.
  // We only check sources that are definitively linked to this dialog instance.
  // We deliberately avoid fallbacks like controlled tokens or game.user.character
  // because those can incorrectly associate the wrong actor (e.g., showing fatigue
  // for a player character when rolling for an NPC).
  let actor = null;

  // Try to get actor from app's options or context
  if (app?.options?.actor) {
    actor = app.options.actor;
  } else if (app?.actor) {
    actor = app.actor;
  } else if (app?.object?.actor) {
    actor = app.object.actor;
  } else if (_context?.actor) {
    actor = _context.actor;
  }

  // If we can't definitively determine the actor from the dialog itself, bail out.
  // This prevents false positives where we'd check the wrong actor's fatigue status.
  if (!actor) return;

  // Check if character has a trait with isFatigue flag set to true
  const isFatigued = actor.items.some((item) => {
    return item.type === "trait" && isTraitFatigue(item);
  });

  if (!isFatigued) return;

  // Add fatigue notice to the dialog
  const footer = root?.querySelector?.("footer.form-footer") ?? null;

  if (!footer) return;

  // Check if we've already added the fatigue notice to avoid duplicates
  if (footer.querySelector(".sta-dice-pool-fatigue-notice")) return;

  const fatigueNotice = document.createElement("div");
  fatigueNotice.className = "sta-dice-pool-fatigue-notice";
  fatigueNotice.innerHTML =
    '<p style="color: #d91e1e; font-weight: bold; margin-top: 10px;">You are fatigued: +1 Difficulty</p>';
  footer.insertBefore(fatigueNotice, footer.firstChild);
}
