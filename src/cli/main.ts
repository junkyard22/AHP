#!/usr/bin/env node

import { Command } from "commander";
import { registerStart } from "./commands/start";
import { registerStatus } from "./commands/status";
import { registerRoles } from "./commands/roles";
import { registerInspect } from "./commands/inspect";
import { registerDoctor } from "./commands/doctor";

const program = new Command();

program
  .name("mailman")
  .description(
    "Local communication runtime for multimodal agent apps.\n" +
    "Passes structured, validated task packets between roles, tools, and services."
  )
  .version("0.1.0");

registerStart(program);
registerStatus(program);
registerRoles(program);
registerInspect(program);
registerDoctor(program);

program.parse(process.argv);
