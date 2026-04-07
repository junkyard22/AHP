import { createAHPTestHarness } from "../WorkbenchTestHarness";
import { defineProtocolSemanticsSuite } from "./protocolSemantics";

defineProtocolSemanticsSuite("experimental AHP protocol verification harness (in-memory)", (options) =>
  createAHPTestHarness({
    transport: "in-memory",
    ...options,
  })
);
