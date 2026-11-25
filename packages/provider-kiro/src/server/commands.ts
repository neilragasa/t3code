import type { ServerProviderSlashCommand } from "@t3tools/contracts";
import type { ProviderWorkspaceSnapshot } from "@t3tools/provider-core/server/driver";
import { COMPACT_SLASH_COMMAND } from "@t3tools/provider-core/server/snapshotProbe";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Kiro advertises its skills, steering files, custom agents and MCP prompts as
 * ACP commands. T3 runs `/compact` itself, so it stays first and wins a clash.
 */
export function kiroSlashCommands(
  commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const slashCommands: Array<ServerProviderSlashCommand> = [COMPACT_SLASH_COMMAND];
  const seen = new Set([COMPACT_SLASH_COMMAND.name]);
  for (const command of commands) {
    const name = command.name.trim().replace(/^\//, "");
    const key = name.toLowerCase();
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    const description = command.description?.trim();
    const hint = command.input?.hint?.trim();
    slashCommands.push({
      name,
      ...(description ? { description } : {}),
      ...(hint ? { input: { hint } } : {}),
    });
  }
  return slashCommands;
}

/**
 * Kiro reports commands per session, and the set depends on the session's cwd
 * (workspace skills). Each report replaces that cwd's list and asks the
 * registry to rescan it. A cwd no session has reported yet keeps the machine
 * snapshot's list.
 */
export const makeKiroWorkspaceCommands = Effect.gen(function* () {
  const byCwd = yield* Ref.make(new Map<string, ReadonlyArray<ServerProviderSlashCommand>>());
  // Retain reports until the registry subscribes; end its listener on teardown.
  const rescans = yield* Queue.unbounded<string, Cause.Done>();
  yield* Effect.addFinalizer(() => Queue.end(rescans));
  return {
    record: (cwd: string, commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>) =>
      Ref.update(byCwd, (current) => new Map(current).set(cwd, kiroSlashCommands(commands))).pipe(
        Effect.andThen(Queue.offer(rescans, cwd)),
        Effect.asVoid,
      ),
    withCommands: (snapshot: ProviderWorkspaceSnapshot, cwd: string) =>
      Ref.get(byCwd).pipe(
        Effect.map((current) => {
          const slashCommands = current.get(cwd);
          return slashCommands === undefined ? snapshot : { ...snapshot, slashCommands };
        }),
      ),
    rescans: Stream.fromQueue(rescans),
  };
}) satisfies Effect.Effect<unknown, never, Scope.Scope>;
