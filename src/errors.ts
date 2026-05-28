export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

export class TokenError extends ConnectorError {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

export class ToolValidationError extends ConnectorError {
  readonly toolKey: string;
  constructor(toolKey: string, message: string) {
    super(message);
    this.name = "ToolValidationError";
    this.toolKey = toolKey;
  }
}
