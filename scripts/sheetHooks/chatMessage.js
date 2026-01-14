import {
  sendCallbackPromptToUser,
  spendDetermination,
} from "../callbackFlow.js";

// Hook to detect when a Determination roll is made in chat and prompt the user to use a callback.
export function installCreateChatMessageHook() {
  Hooks.on("createChatMessage", async (message) => {
    if (!game.user.isGM) return;

    const html = message.content ?? "";
    if (!html.includes('class="sta roll chat card"')) return;
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
        err
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
