import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockIpc, DEFAULT_SCRIPT } from "../src/ipc/mock.ts";
import { DEFAULT_SETTINGS, type StreamEvent } from "../src/ipc/contract.ts";

const req = { model: "test/free-model", messages: [] };

test("chatStream plays the scripted events in order", async () => {
  const ipc = createMockIpc();
  const events: StreamEvent[] = [];
  await ipc.chatStream(req, (e) => events.push(e));
  assert.deepEqual(events, DEFAULT_SCRIPT[0]);
  assert.deepEqual(ipc.chatRequests, [req]);
});

test("default script slices tool_call arguments across deltas", async () => {
  const ipc = createMockIpc();
  let args = "";
  await ipc.chatStream(req, (e) => {
    if (e.type === "delta" && e.tool_calls) {
      for (const tc of e.tool_calls) args += tc.function?.arguments ?? "";
    }
  });
  assert.deepEqual(JSON.parse(args), { path: "/tmp/a.txt" });
});

test("chatStream cycles to the next scripted stream per call", async () => {
  const ipc = createMockIpc();
  await ipc.chatStream(req, () => {});
  const second: StreamEvent[] = [];
  await ipc.chatStream(req, (e) => second.push(e));
  assert.deepEqual(second, DEFAULT_SCRIPT[1]);
});

test("chatStream stops delivering events once the signal aborts", async () => {
  const ipc = createMockIpc();
  const controller = new AbortController();
  const events: StreamEvent[] = [];
  await ipc.chatStream(
    req,
    (e) => {
      events.push(e);
      controller.abort();
    },
    controller.signal,
  );
  assert.equal(events.length, 1);
});

test("toolReadFile returns fake file content", async () => {
  const ipc = createMockIpc({ files: { "/notes.md": "# hello" } });
  assert.equal(await ipc.toolReadFile("/notes.md"), "# hello");
});

test("toolReadFile rejects for missing files like tools.rs", async () => {
  const ipc = createMockIpc();
  await assert.rejects(
    () => ipc.toolReadFile("/nope.txt"),
    /file not found: \/nope\.txt/,
  );
});

test("settings default to DEFAULT_SETTINGS and round-trip through set/get", async () => {
  const ipc = createMockIpc();
  assert.deepEqual(await ipc.getSettings(), DEFAULT_SETTINGS);

  const next = { ...DEFAULT_SETTINGS, api_key: "sk-test", observe_interval: 30 };
  await ipc.setSettings(next);
  assert.deepEqual(await ipc.getSettings(), next);
});

test("captureScreen rejects while observation is disabled", async () => {
  const ipc = createMockIpc();
  await assert.rejects(() => ipc.captureScreen(), /observation disabled/);
});

test("captureScreen returns a JPEG data URL when observation is enabled", async () => {
  const ipc = createMockIpc({ settings: { observe_enabled: true } });
  assert.match(await ipc.captureScreen(), /^data:image\/jpeg;base64,/);
});

test("activeWindow cycles through the scripted window sequence", async () => {
  const code = { app_name: "Code", title: "main.rs — Sage" };
  const ipc = createMockIpc({ windows: [code, null] });
  assert.deepEqual(await ipc.activeWindow(), code);
  assert.equal(await ipc.activeWindow(), null);
  assert.deepEqual(await ipc.activeWindow(), code);
});

test("calls are recorded for assertions", async () => {
  const ipc = createMockIpc({ files: { "/a": "x" } });
  await ipc.getSettings();
  await ipc.toolReadFile("/a");
  assert.deepEqual(
    ipc.calls.map((c) => c.command),
    ["get_settings", "tool_read_file"],
  );
});
