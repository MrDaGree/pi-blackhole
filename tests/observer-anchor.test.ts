/**
 * Observer anchor on never-compacted sessions (issue #87).
 *
 * runObserverStage resolves its start anchor as: cursor > observation
 * coverage marker > last compaction entry. With none of those (fresh
 * session, subagent below compaction threshold) the anchor is -1 and the
 * stage must measure the full history (rawTokensAfterIndex clamps -1 to
 * index 0) — not zero it out, which left the observer stuck on not_due
 * forever until the first compaction existed.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

import { Runtime } from "../src/om/runtime.js";
import { anyStageDue, runObserverStage, type ConsolidationCtx } from "../src/om/consolidation.js";
import { OM_OBSERVATIONS_RECORDED } from "../src/om/ledger/types.js";
import type { Entry } from "@earendil-works/pi-ai";

const runObserverSpy = vi.hoisted(() => vi.fn());

vi.mock("../src/om/agents/observer/agent.js", () => ({
  runObserver: runObserverSpy,
}));

function messageEntry(id: string, text: string): Entry {
  return {
    type: "message",
    id,
    message: { role: "user", content: [{ type: "text", text }] },
  } as unknown as Entry;
}

function ctxWith(entries: Entry[]): ConsolidationCtx {
  return {
    cwd: "/tmp",
    hasUI: false,
    ui: undefined,
    model: undefined,
    modelRegistry: {
      find: () => undefined,
      getApiKeyAndHeaders: async () => ({ ok: false }),
    },
    sessionManager: {
      getBranch: () => entries,
      getSessionId: () => "test-session",
    },
  } as unknown as ConsolidationCtx;
}

function makeRuntime(observeAfterTokens: number): Runtime {
  const runtime = new Runtime();
  runtime.config.memory = true;
  runtime.config.compaction = undefined;
  runtime.config.compactionEngine = undefined;
  runtime.config.observeAfterTokens = observeAfterTokens;
  return runtime;
}

// ~300 estimated tokens per entry, above the 100-token test threshold
const text = (sentinel: string) => `${sentinel} ${"x".repeat(1200)}`;

function resolveModelOk() {
  return async () => ({
    ok: true as const,
    model: { provider: "test", id: "m", contextWindow: 100_000 },
    apiKey: "test",
  });
}

function runStage(runtime: Runtime, entries: Entry[]) {
  const generation = runtime.captureGeneration("test-session");
  return runObserverStage(
    { appendEntry: vi.fn() } as any,
    runtime,
    ctxWith(entries),
    generation,
    resolveModelOk(),
  );
}

beforeEach(() => {
  runObserverSpy.mockReset();
  runObserverSpy.mockResolvedValue({
    observations: [],
    emptyReason: { kind: "no_new_content" as const },
  });
});

describe("runObserverStage anchor (issue #87)", () => {
  test("observer runs on a never-compacted session (anchor -1 → full history)", async () => {
    const entries = [messageEntry("e1", text("EARLY-BACKLOG")), messageEntry("e2", text("LATER"))];
    const runtime = makeRuntime(100);

    const outcome = await runStage(runtime, entries);

    expect(outcome).toBe("continue");
    // Red before the fix: stage bailed at tokens=0 and never called the model.
    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    // T4: the chunk must cover the backlog from the very first entry.
    const arg = runObserverSpy.mock.calls[0]![0] as { chunk: string };
    expect(arg.chunk).toContain("EARLY-BACKLOG");
    expect(arg.chunk).toContain("LATER");
  });

  test("observer stays not_due below threshold on a never-compacted session", async () => {
    const entries = [messageEntry("e1", "short")];
    const runtime = makeRuntime(100);

    const outcome = await runStage(runtime, entries);

    expect(outcome).toBe("continue");
    expect(runObserverSpy).not.toHaveBeenCalled();
    // The below-threshold entry stays unobserved: with nothing measured yet the
    // stage must not create a cursor that hides it from later checks.
    expect(runtime.getCursor("observer")).toBeUndefined();
  });

  test("small additions accumulate until the observer threshold is reached", async () => {
    const runtime = makeRuntime(100);
    const entries: Entry[] = [];
    for (let i = 0; i < 6 && runObserverSpy.mock.calls.length === 0; i += 1) {
      entries.push(messageEntry(`small-${i}`, `SMALL-SENTINEL-${i} ${"x".repeat(110)}`));
      await runStage(runtime, entries);
    }

    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    const arg = runObserverSpy.mock.calls[0]![0] as { chunk: string };
    // The first addition is only ~32 tokens; it must still be observed once the
    // accumulated total crosses the threshold.
    expect(arg.chunk).toContain("SMALL-SENTINEL-0");
  });

  test("keeps unobserved content when another due stage launches the pipeline", async () => {
    const runtime = makeRuntime(100);
    runtime.config.reflectAfterTokens = 1;
    const marker: Entry = {
      type: "custom",
      customType: OM_OBSERVATIONS_RECORDED,
      id: "m1",
      data: {
        coversUpToId: "old1",
        observations: [{ content: "prior observation" }],
      },
    } as unknown as Entry;
    const first = [
      messageEntry("old1", "OLD-COVERED"),
      marker,
      messageEntry("new1", "NEW-UNOBSERVED"),
    ];

    // The reflector is due, so the pipeline launches although the observer is not.
    expect(anyStageDue(first, runtime, undefined)).toBe(true);
    await runStage(runtime, first);
    expect(runObserverSpy).not.toHaveBeenCalled();

    const second = [...first, messageEntry("new2", text("BIG-ADDITION"))];
    await runStage(runtime, second);

    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    const arg = runObserverSpy.mock.calls[0]![0] as { chunk: string };
    expect(arg.chunk).toContain("NEW-UNOBSERVED");
    expect(arg.chunk).toContain("BIG-ADDITION");
  });

  test("does not re-observe the same entries after an empty observer outcome", async () => {
    const entries = [messageEntry("e1", text("ONLY-CHUNK"))];
    const runtime = makeRuntime(100);

    await runStage(runtime, entries);
    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    expect(runtime.getCursor("observer")?.state).toBe("empty");

    await runStage(runtime, entries);
    expect(runObserverSpy).toHaveBeenCalledTimes(1);
  });

  test("falls back to the full history when the observer cursor entry no longer exists", async () => {
    const runtime = makeRuntime(100);
    runtime.advanceCursor("observer", "missing-entry", "recorded");
    const entries = [messageEntry("e1", text("STALE-FALLBACK"))];

    await runStage(runtime, entries);

    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    const arg = runObserverSpy.mock.calls[0]![0] as { chunk: string };
    expect(arg.chunk).toContain("STALE-FALLBACK");
  });

  test("observer still anchors to the last compaction entry when one exists", async () => {
    const compaction: Entry = {
      type: "compaction",
      id: "c1",
      summary: "summary",
    } as unknown as Entry;
    const entries = [
      messageEntry("pre1", text("PRE-COMPACTION")),
      compaction,
      messageEntry("post1", text("POST-COMPACTION")),
    ];
    const runtime = makeRuntime(100);

    await runStage(runtime, entries);

    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    const arg = runObserverSpy.mock.calls[0]![0] as { chunk: string };
    // Post-compaction content is processed…
    expect(arg.chunk).toContain("POST-COMPACTION");
    // …pre-compaction content is not (unchanged anchoring behavior).
    expect(arg.chunk).not.toContain("PRE-COMPACTION");
  });

  test("observer still anchors to the observation coverage marker when one exists", async () => {
    const marker: Entry = {
      type: "custom",
      customType: OM_OBSERVATIONS_RECORDED,
      id: "m1",
      data: {
        coversUpToId: "old1",
        observations: [{ content: "prior observation" }],
      },
    } as unknown as Entry;
    const entries = [
      messageEntry("old1", text("OLD-COVERED")),
      marker,
      messageEntry("new1", text("NEW-UNCOVERED")),
    ];
    const runtime = makeRuntime(100);

    await runStage(runtime, entries);

    expect(runObserverSpy).toHaveBeenCalledTimes(1);
    const arg = runObserverSpy.mock.calls[0]![0] as { chunk: string };
    expect(arg.chunk).toContain("NEW-UNCOVERED");
    expect(arg.chunk).not.toContain("OLD-COVERED");
  });
});
