import assert from "node:assert/strict";
import test from "node:test";
import extension from "../index.ts";

test.beforeEach(() => { delete globalThis[Symbol.for("pi-t3-reload.reloading")]; });

function setup(overrides = {}) {
  const commands = new Map();
  const events = new Map();
  const notices = [];
  let reloads = 0;
  extension({
    registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => events.set(name, handler),
  });
  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify: (...args) => notices.push(args) },
    reload: async () => { reloads++; },
    ...overrides,
  };
  return { commands, events, notices, ctx, reloads: () => reloads };
}

test("registers only /t3-reload to avoid Pi's built-in /reload", () => {
  const s = setup();
  assert.deepEqual([...s.commands.keys()], ["t3-reload"]);
});

test("/t3-reload reloads an idle session without reusing its context", async () => {
  const s = setup();
  const ctx = new Proxy(s.ctx, {
    get(target, property) {
      assert.equal(s.reloads(), 0, "used stale context after reload");
      return target[property];
    },
  });
  await s.commands.get("t3-reload").handler("", ctx);
  assert.equal(s.reloads(), 1);
  assert.deepEqual(s.notices, []);
});

for (const [label, overrides] of [
  ["active run", { isIdle: () => false }],
  ["queued messages", { hasPendingMessages: () => true }],
]) {
  test(`refuses reload during ${label}`, async () => {
    const s = setup(overrides);
    await s.commands.get("t3-reload").handler("", s.ctx);
    assert.equal(s.reloads(), 0);
    assert.equal(s.notices[0][1], "warning");
  });
}

test("rejects arguments rather than silently ignoring them", async () => {
  const s = setup();
  await s.commands.get("t3-reload").handler("--force", s.ctx);
  assert.equal(s.reloads(), 0);
  assert.match(s.notices[0][0], /Usage/);
});

test("refuses overlap, including from the copy reload loads", async () => {
  let finish;
  const s = setup({ reload: () => new Promise(resolve => { finish = resolve; }) });
  const first = s.commands.get("t3-reload").handler("", s.ctx);
  const reloaded = setup();
  await reloaded.commands.get("t3-reload").handler("", reloaded.ctx);
  assert.deepEqual(reloaded.notices, [["Reload already in progress.", "warning"]]);
  assert.equal(reloaded.reloads(), 0);
  finish();
  await first;
  await reloaded.commands.get("t3-reload").handler("", reloaded.ctx);
  assert.equal(reloaded.reloads(), 1);
});

test("refuses quietly when the in-progress reload left this context stale", async () => {
  const finishes = [];
  let calls = 0;
  let notifies = 0;
  const s = setup({ reload: () => { calls++; return new Promise(resolve => finishes.push(resolve)); } });
  const first = s.commands.get("t3-reload").handler("", s.ctx);
  const stale = { ...s.ctx, ui: { notify: () => { notifies++; throw new Error("stale ctx"); } } };
  try {
    for (const args of ["", "extra"]) await s.commands.get("t3-reload").handler(args, stale);
    assert.equal(calls, 1);
    assert.equal(notifies, 2);
  } finally {
    for (const finish of finishes) finish();
    await first;
  }
});

test("propagates reload failures and resets its guard", async () => {
  const error = new Error("reload failed");
  const s = setup({ reload: async () => { throw error; } });
  await assert.rejects(s.commands.get("t3-reload").handler("", s.ctx), error);
  s.ctx.reload = async () => {};
  await s.commands.get("t3-reload").handler("", s.ctx);
  assert.deepEqual(s.notices, []);
});

test("reports reload from the fresh session context only", () => {
  const s = setup();
  const started = s.events.get("session_start");
  started({ reason: "startup" }, s.ctx);
  assert.deepEqual(s.notices, []);
  started({ reason: "reload" }, s.ctx);
  assert.deepEqual(s.notices, [["Pi runtime reloaded.", "info"]]);
});
