import { sendCallbackPromptToUser, spendDetermination } from "./gmFlow.js";
import { MODULE_ID } from "../core/constants.js";
import {
  AUTO_CALLBACK_ON_DETERMINATION_ROLL_SETTING,
  hasActiveMission,
} from "../missions/mission.js";

// Hook to detect when a Determination roll is made in chat and prompt the user to use a callback.
export function installCreateChatMessageHook() {
  Hooks.on("createChatMessage", async (message) => {
    // Detect determination usage: prefer structured flags (STA v2.5.0+),
    // fall back to HTML content parsing for older versions.
    const staFlags = message.flags?.sta;
    const determinationViaFlags = staFlags?.usingDetermination === true;

    if (!determinationViaFlags) {
      const html = message.content ?? "";
      const hasCard =
        html.includes('class="chatcard"') ||
        html.includes('class="sta roll chat card"');
      if (!hasCard || !/\bDetermination\b/i.test(html)) return;
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

    // Skip callback auto-prompt when no mission is active.
    if (!hasActiveMission()) return;

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
    if (game.staofficerslog?.hasUsedCallbackThisMission?.(targetUser.id)) {
      return;
    }

    await sendCallbackPromptToUser(targetUser, {
      reason: "Determination used in STA roll",
      messageId: message.id,
    });
  });
}
