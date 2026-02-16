// Hooks - Foundry VTT hook registrations
// Re-exports hook installation functions

export { installRenderApplicationV2Hook } from "./renderAppV2/hook.js";
export { installCreateChatMessageHook } from "./chatMessage.js";
export {
  installReputationSpendHook,
  promptGMSpendDialog,
  triggerAllPlayersAcclaimSurvey,
} from "./reputationSpend.js";
export { openGMSurveyMonitor } from "./renderAppV2/gmSurveyMonitor.js";
