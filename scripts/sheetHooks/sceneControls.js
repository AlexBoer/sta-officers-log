import { t } from "../i18n.js";

export function installSceneControlButtonsHook() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    const sendTool = {
      name: "sta-officers-log-send",
      title: t("sta-officers-log.tools.sendPrompt"),
      icon: "fa-solid fa-reply",
      button: true,
      visible: true,
      order: 9990,
      onClick: () => game.staCallbacksHelper.open(),
    };

    const resetTool = {
      name: "sta-officers-log-reset",
      title: t("sta-officers-log.tools.resetMission"),
      icon: "fa-solid fa-book",
      button: true,
      visible: true,
      order: 9991,
      onClick: () => game.staCallbacksHelper.promptNewMissionAndReset(),
    };

    const newSceneTool = {
      name: "sta-officers-log-new-scene",
      title: t("sta-officers-log.tools.newScene"),
      icon: "fa-solid fa-clapperboard",
      button: true,
      visible: true,
      order: 9992,
      onClick: () => game.staCallbacksHelper.newScene(),
    };

    if (Array.isArray(controls)) {
      const tokenControl =
        controls.find((c) => c?.name === "token") ??
        controls.find((c) => c?.name === "tokens");
      if (!tokenControl) return;

      tokenControl.tools ??= [];
      if (!tokenControl.tools.some((t) => t?.name === sendTool.name)) {
        tokenControl.tools.push(sendTool);
      }
      if (!tokenControl.tools.some((t) => t?.name === resetTool.name)) {
        tokenControl.tools.push(resetTool);
      }
      if (!tokenControl.tools.some((t) => t?.name === newSceneTool.name)) {
        tokenControl.tools.push(newSceneTool);
      }

      return;
    }

    const tokenControls = controls?.tokens;
    if (!tokenControls) return;
    tokenControls.tools ??= {};
    tokenControls.tools[sendTool.name] = sendTool;
    tokenControls.tools[resetTool.name] = resetTool;
    tokenControls.tools[newSceneTool.name] = newSceneTool;
  });
}
