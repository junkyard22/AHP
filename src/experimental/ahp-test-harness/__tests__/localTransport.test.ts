import { createAHPTestHarness } from "../WorkbenchTestHarness";
import { defineProtocolSemanticsSuite } from "./protocolSemantics";

defineProtocolSemanticsSuite("experimental AHP protocol verification harness (local transport)", (options) =>
  createAHPTestHarness({
    transport: "local",
    ...options,
  }),
  { includeDefaultOff: false }
);
