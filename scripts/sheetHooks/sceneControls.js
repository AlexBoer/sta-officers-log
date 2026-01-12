import { t } from "../i18n.js";

export function installSceneControlButtonsHook() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    // Foundry v13+ prefers SceneControlTool#onChange over #onClick.
    // These are "button" tools, so we run the action on activation.
    const buttonOnChange = (fn) => (_event, active) => {
      if (active === false) return;
      return fn();
    };

    const sendTool = {
      name: "sta-officers-log-send",
      title: t("sta-officers-log.tools.sendPrompt"),
      icon: "fa-solid fa-reply",
      button: true,
      visible: true,
      order: 9990,
      onChange: buttonOnChange(() => game.staCallbacksHelper.open()),
    };

    const resetTool = {
      name: "sta-officers-log-reset",
      title: t("sta-officers-log.tools.resetMission"),
      icon: "fa-solid fa-book",
      button: true,
      visible: true,
      order: 9991,
      onChange: buttonOnChange(() =>
        game.staCallbacksHelper.promptNewMissionAndReset()
      ),
    };

    const newSceneTool = {
      name: "sta-officers-log-new-scene",
      title: t("sta-officers-log.tools.newScene"),
      icon: "fa-solid fa-clapperboard",
      button: true,
      visible: true,
      order: 9992,
      onChange: buttonOnChange(() => game.staCallbacksHelper.newScene()),
    };

    const staControlName = "sta-officers-log";
    const staControl = {
      name: staControlName,
      title: t("sta-officers-log.sceneControls.title"),
      icon: "fa-solid fa-starship",
      layer: "TokenLayer",
      tools: [sendTool, resetTool, newSceneTool],
      visible: true,
      order: 9990,
    };

    if (Array.isArray(controls)) {
      // Remove our tools from Token controls (if present from older versions).
      const tokenControl =
        controls.find((c) => c?.name === "token") ??
        controls.find((c) => c?.name === "tokens");
      if (tokenControl?.tools && Array.isArray(tokenControl.tools)) {
        tokenControl.tools = tokenControl.tools.filter(
          (tool) =>
            tool?.name !== sendTool.name &&
            tool?.name !== resetTool.name &&
            tool?.name !== newSceneTool.name
        );
      }

      const existing = controls.find((c) => c?.name === staControlName);
      if (existing) {
        existing.tools = staControl.tools;
        existing.title = staControl.title;
        existing.icon = staControl.icon;
        existing.layer = staControl.layer;
        existing.visible = true;
        existing.order ??= staControl.order;
      } else {
        controls.push(staControl);
      }

      return;
    }

    // Object-style controls shape.
    // Some Foundry/system combinations provide an object record rather than an array.
    // In that case, register our own control entry and remove tools from Token controls.
    const tokenControls = controls?.token ?? controls?.tokens;

    // Remove from Token controls if present.
    try {
      const tools = tokenControls?.tools;
      if (Array.isArray(tools)) {
        tokenControls.tools = tools.filter(
          (tool) =>
            tool?.name !== sendTool.name &&
            tool?.name !== resetTool.name &&
            tool?.name !== newSceneTool.name
        );
      } else if (tools && typeof tools === "object") {
        delete tools[sendTool.name];
        delete tools[resetTool.name];
        delete tools[newSceneTool.name];
      }
    } catch (_) {
      // ignore
    }

    // Register our own control category.
    // For object-style controls, tools are commonly represented as a name->tool mapping.
    controls[staControlName] ??= {
      name: staControlName,
      title: staControl.title,
      icon: staControl.icon,
      layer: staControl.layer,
      visible: true,
      order: staControl.order,
      tools: {},
    };

    controls[staControlName].title = staControl.title;
    controls[staControlName].icon = staControl.icon;
    controls[staControlName].layer = staControl.layer;
    controls[staControlName].visible = true;
    controls[staControlName].order ??= staControl.order;
    controls[staControlName].tools ??= {};

    // Ensure tools exist under our control.
    if (Array.isArray(controls[staControlName].tools)) {
      controls[staControlName].tools = [sendTool, resetTool, newSceneTool];
    } else {
      controls[staControlName].tools[sendTool.name] = sendTool;
      controls[staControlName].tools[resetTool.name] = resetTool;
      controls[staControlName].tools[newSceneTool.name] = newSceneTool;
    }
  });
}
