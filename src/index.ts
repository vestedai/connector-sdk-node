export { agent, readAgentDeclaration, type Instruction, type AgentDecl, type AgentDeclaration } from "./agent.ts";
export { tool, readToolDeclaration, validateArgs, ToolHandler, TOOL_SENSITIVITIES, type ToolContext, type ToolDecl, type ToolDeclaration, type ToolSensitivity } from "./tool.ts";
export { ConnectorError, TokenError, ToolValidationError } from "./errors.ts";
export { ConnectorApp, isConnectorApp, CONNECTOR_APP_BRAND, type Logger } from "./app.ts";
export { CredentialOpener, CredentialError, CREDENTIAL_ALG, type CredentialEnvelope, type CredentialErrorCode } from "./credential.ts";
export {
  CredentialOpDispatcher,
  credentialOk,
  credentialFailed,
  type CredentialContext,
  type CredentialValidation,
  type UserCredentialHandler,
} from "./credential-handler.ts";
export { CredentialResolver, CredentialUnavailableError } from "./credential-resolver.ts";
export const __version__ = "0.4.0";
