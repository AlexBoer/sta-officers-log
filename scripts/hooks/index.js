// Hooks - Foundry VTT hook registrations
// Re-exports hook installation functions

export { installRenderApplicationV2Hook } from "./renderAppV2/hook.js";
export { installCreateChatMessageHook } from "./chatMessage.js";
export { installStressMonitoringHook } from "./stressHook.js";
export {
  AMBIENT_AUDIO_SELECTION_ONLY_SETTING,
  installAmbientAudioSelectionListenerPatch,
  setPlayerAmbientAudioSelectionOnlyEnabled,
} from "./ambientAudioPatch.js";
export { installMacroActorImageHook } from "./macroActorImage.js";
