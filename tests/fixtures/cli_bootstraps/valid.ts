/**
 * Fixture: a valid bootstrap that default-exports a ConnectorApp instance.
 * Used by cli.test.ts to verify the CLI loads and accepts a well-formed bootstrap.
 */

import { ConnectorApp } from "../../../src/app.ts";

export default ConnectorApp.create().build();
