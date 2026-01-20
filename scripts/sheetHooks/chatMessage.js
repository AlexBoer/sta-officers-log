import {
  sendCallbackPromptToUser,
  spendDetermination,
} from "../callbackFlow.js";
import { MODULE_ID } from "../constants.js";
import { AUTO_CALLBACK_ON_DETERMINATION_ROLL_SETTING } from "../mission.js";
import { isTraitFatigue } from "./renderAppV2/itemFlags.js";

// Hook to detect when a Determination roll is made in chat and prompt the user to use a callback.
// Also checks if the character is fatigued and adds a note to the chat message.
export function installCreateChatMessageHook() {
  Hooks.on("createChatMessage", async (message) => {
    const html = message.content ?? "";
    if (!html.includes('class="sta roll chat card"')) return;

    // Check if character is fatigued and add notice to chat message
    try {
      const speakerActorId = message.speaker?.actor;
      const actor = speakerActorId ? game.actors?.get?.(speakerActorId) : null;

      if (actor) {
        // Check for trait with isFatigue flag set to true
        const isFatigued = actor.items.some((item) => {
          return item.type === "trait" && isTraitFatigue(item);
        });

        if (isFatigued) {
          const characterName = actor.name ?? "Character";
          const fatigueNotice = `<div class="sta-fatigue-notice"><strong>${characterName} is Fatigued: +1 Difficulty.</strong></div>`;
          message.content = html + fatigueNotice;
          await message.update({ content: message.content });
        }
      }
    } catch (err) {
      console.warn("sta-officers-log | Failed to check fatigue status", err);
    }

    // Feature toggle: disable automatic Determination scanning/prompting unless enabled.
    try {
      const enabled = Boolean(
        game.settings.get(
          MODULE_ID,
          AUTO_CALLBACK_ON_DETERMINATION_ROLL_SETTING,
        ),
      );
      if (!enabled) return;
    } catch (_) {
      // If settings are unavailable for some reason, fail closed.
      return;
    }

    if (!game.user.isGM) return;

    if (!/\bDetermination\b/i.test(html)) return;

    const authorId = message.author?.id ?? message.user?.id;
    if (!authorId) return;

    const targetUser = game.users.get(authorId);
    if (!targetUser || !targetUser.active || targetUser.isGM) return;

    // Spend 1 determination automatically when a roll uses Determination.
    // Prefer the message speaker actor; fall back to the user's assigned character.
    try {
      const speakerActorId = message.speaker?.actor;
      const actor = speakerActorId
        ? game.actors?.get?.(speakerActorId)
        : targetUser.character;
      if (actor) await spendDetermination(actor);
    } catch (err) {
      console.warn(
        "sta-officers-log | Failed to spend determination for roll",
        err,
      );
    }

    // Avoid double prompt for same mission.
    // (The core callback flow also checks this, but this prevents the whole prompt code from running at every message.)
    // eslint-disable-next-line no-undef
    if (game.staCallbacksHelper?.hasUsedCallbackThisMission?.(targetUser.id)) {
      return;
    }

    await sendCallbackPromptToUser(targetUser, {
      reason: "Determination used in STA roll",
      messageId: message.id,
    });
  });
}
