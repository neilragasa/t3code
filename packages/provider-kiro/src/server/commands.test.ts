import { assert, describe, it } from "@effect/vitest";
import type { ProviderWorkspaceSnapshot } from "@t3tools/provider-core/server/driver";
import { COMPACT_SLASH_COMMAND } from "@t3tools/provider-core/server/snapshotProbe";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/compat";

import { kiroSlashCommands, makeKiroWorkspaceCommands } from "./commands.ts";

// Shapes from `available_commands_update` on Kiro CLI 3.6 (agent engine v3).
const skill: EffectAcpSchema.AvailableCommand = {
  name: "improve-codebase-architecture",
  description: "Scan a codebase for deepening opportunities.",
  input: { type: "text", hint: "optional context" },
  _meta: { kiro: { type: "skill", resource: { source: { origin: "user" } } } },
};
const agent: EffectAcpSchema.AvailableCommand = {
  name: "general-task-execution",
  description: "General-purpose sub-agent",
  input: { type: "text", hint: "task to delegate" },
  _meta: { kiro: { type: "custom-agent", resource: { source: { origin: "bundled" } } } },
};

describe("kiroSlashCommands", () => {
  it("lists Kiro's commands after T3's /compact, once each", () => {
    assert.deepEqual(
      kiroSlashCommands([
        skill,
        agent,
        { name: "/Compact", description: "Kiro's own" },
        { ...skill, description: "dupe" },
      ]),
      [
        COMPACT_SLASH_COMMAND,
        {
          name: "improve-codebase-architecture",
          description: "Scan a codebase for deepening opportunities.",
          input: { hint: "optional context" },
        },
        {
          name: "general-task-execution",
          description: "General-purpose sub-agent",
          input: { hint: "task to delegate" },
        },
      ],
    );
  });
});

describe("makeKiroWorkspaceCommands", () => {
  const machineSnapshot = {
    slashCommands: [COMPACT_SLASH_COMMAND],
  } as unknown as ProviderWorkspaceSnapshot;

  it.effect("scopes a session's commands to its cwd and asks for that cwd's rescan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const commands = yield* makeKiroWorkspaceCommands;
        assert.strictEqual(yield* commands.withCommands(machineSnapshot, "/repo"), machineSnapshot);

        yield* commands.record("/repo", [skill]);
        assert.deepEqual(
          (yield* commands.withCommands(machineSnapshot, "/repo")).slashCommands.map(
            (command) => command.name,
          ),
          ["compact", "improve-codebase-architecture"],
        );
        assert.strictEqual(
          yield* commands.withCommands(machineSnapshot, "/other"),
          machineSnapshot,
        );
        assert.deepEqual(yield* Stream.runCollect(Stream.take(commands.rescans, 1)), ["/repo"]);
      }),
    ),
  );
});
