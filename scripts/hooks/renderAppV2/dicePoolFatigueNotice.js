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

  // Get the speaker actor from the context or from the last used actor
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
  } else {
    // Try to get the last controlled token's actor
    const controlledTokens = canvas?.tokens?.controlled ?? [];
    if (controlledTokens.length > 0) {
      actor = controlledTokens[0].actor;
    } else if (game?.user?.character) {
      actor = game.user.character;
    }
  }

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
