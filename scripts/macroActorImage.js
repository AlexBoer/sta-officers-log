import { MODULE_ID } from "./constants.js";

/**
 * When a macro is created by dragging an actor to the hotbar,
 * automatically set the macro image to the actor's token image.
 *
 * Foundry creates these macros with a command like:
 *   await foundry.applications.ui.Hotbar.toggleDocumentSheet("Actor.1fldgOHgJd5eSHpz");
 */
export function installMacroActorImageHook() {
  Hooks.on("preCreateMacro", (macro, data, options, userId) => {
    try {
      // Only process script macros
      if (data.type !== "script") return;

      // Check if this looks like an actor sheet macro
      // Foundry generates: await foundry.applications.ui.Hotbar.toggleDocumentSheet("Actor.ACTOR_ID");
      const command = data.command || "";
      const match = command.match(/toggleDocumentSheet\(["']([^"']+)["']\)/);

      if (!match) return;

      const docString = match[1];
      // docString format: "Actor.1fldgOHgJd5eSHpz"
      if (!docString.startsWith("Actor.")) return;

      const actorId = docString.substring("Actor.".length);
      const actor = game.actors.get(actorId);

      if (!actor) return;

      // Get the token image (prototypeToken.texture.src)
      const tokenImg = actor.prototypeToken?.texture?.src;

      if (tokenImg && tokenImg !== "icons/svg/mystery-man.svg") {
        // Modify the pending creation data to use the token image
        macro.updateSource({ img: tokenImg });
        console.log(
          `${MODULE_ID} | Set macro image to actor token: ${tokenImg}`,
        );
      }
    } catch (err) {
      console.error(`${MODULE_ID} | macroActorImage hook failed`, err);
    }
  });
}
