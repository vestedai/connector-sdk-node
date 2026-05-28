/**
 * Bootstrap for the notion-tasks-tracker connector example.
 *
 * Dev run:
 *   node --import tsx/esm node_modules/.bin/vested-connect worker --bootstrap=./bootstrap.ts
 *
 * Prod run (after tsc):
 *   node dist/bootstrap.js (via vested-connect worker --bootstrap=./dist/bootstrap.js)
 */

import { ConnectorApp } from "@vested-ai/connector-sdk";

const app = (await ConnectorApp.create().scanModule(import.meta.url)).build();

export default app;
