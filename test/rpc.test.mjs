import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = process.env.PI_TEST_CLI;
const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
const options = { skip: cli ? false : "Set PI_TEST_CLI to an installed Pi JavaScript CLI entrypoint", timeout: 45000 };

// Starts real Pi in RPC mode with an isolated profile, a persisted temporary session, and a probe extension.
async function startPi(t, probeSource) {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-t3-reload-"));
  const profile = path.join(dir, "profile");
  await mkdir(profile);
  const probe = path.join(dir, "probe.ts");
  const writeProbe = source => writeFile(probe, source);
  await writeProbe(probeSource);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PI_|T3_)/i.test(key)));
  Object.assign(env, { PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", PI_TELEMETRY: "0" });
  const child = spawn(process.execPath, [path.resolve(cli), "--mode", "rpc", "--offline",
    "--session-dir", path.join(dir, "sessions"), "--no-approve", "--no-extensions", "--no-mcp", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools",
    "--extension", extension, "--extension", probe], {
    cwd: dir, env, stdio: ["pipe", "pipe", "pipe"],
  });
  const records = [];
  const pending = new Map();
  let buffer = "";
  let stderr = "";
  let nextId = 0;
  let exited = false;
  const closed = once(child, "close");
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); }
      catch (error) {
        for (const p of pending.values()) p.reject(error);
        pending.clear();
        continue;
      }
      records.push(record);
      if (record.type === "response" && pending.has(record.id)) {
        const p = pending.get(record.id);
        pending.delete(record.id);
        if (record.success) p.resolve(record.data);
        else p.reject(new Error(record.error));
      }
    }
  });
  child.on("close", () => {
    exited = true;
    for (const p of pending.values()) p.reject(new Error(`Pi exited: ${stderr}`));
    pending.clear();
  });
  // Windows cannot remove the working directory until Pi exits.
  t.after(async () => {
    if (!exited) {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      try { await closed; } finally { clearTimeout(timer); }
    }
    await rm(dir, { recursive: true, force: true });
  });
  function request(type, fields = {}) {
    if (exited) return Promise.reject(new Error(`Pi already exited: ${stderr}`));
    const id = String(++nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${type}: ${stderr}`));
      }, 15000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
    });
  }
  const notices = message => records.filter(r => r.method === "notify" && r.message === message).length;
  async function waitForNotice(message, count = 1) {
    for (let i = 0; i < 100 && notices(message) < count; i++) await delay(100);
    assert.equal(notices(message), count, `Expected ${count} "${message}" notices: ${JSON.stringify(records)}`);
  }
  return { request, records, notices, waitForNotice, writeProbe };
}

const probe = version => `export default function(pi) {
  pi.registerCommand("reload-probe", { handler: (_args, ctx) => ctx.ui.notify("probe-${version}", "info") });
  pi.registerCommand("record-probe", { handler: () => pi.appendEntry("reload-test", { sentinel: true }) });
}`;

test("real Pi RPC reloads changed resources and retains session entries without a model call", options, async t => {
  const pi = await startPi(t, probe("v1"));
  const inventory = await pi.request("get_commands");
  assert.ok(inventory.commands.some(c => c.name === "t3-reload"));
  assert.ok(!inventory.commands.some(c => c.name === "reload"));
  assert.equal((await pi.request("prompt", { message: "/record-probe" })).disposition, "handled");
  const before = await pi.request("get_state");
  assert.ok(before.sessionFile, "expected a persisted session");
  const entries = (await pi.request("get_entries")).entries;
  assert.ok(entries.some(e => e.customType === "reload-test"));
  await pi.request("prompt", { message: "/reload-probe" });
  await pi.waitForNotice("probe-v1");
  await pi.writeProbe(probe("v2"));
  for (let reload = 1; reload <= 2; reload++) {
    assert.equal((await pi.request("prompt", { message: "/t3-reload" })).disposition, "handled");
    await pi.waitForNotice("Pi runtime reloaded.", reload);
    const state = await pi.request("get_state");
    assert.equal(state.sessionId, before.sessionId);
    assert.equal(state.isStreaming, false);
    assert.deepEqual((await pi.request("get_entries")).entries, entries);
  }
  await pi.request("prompt", { message: "/reload-probe" });
  await pi.waitForNotice("probe-v2");
  assert.equal(pi.records.filter(r => r.type === "extension_error").length, 0, JSON.stringify(pi.records));
  assert.equal(pi.records.filter(r => r.type === "agent_start").length, 0);
});

test("real Pi RPC refuses a second reload while the first is still starting the new runtime", options, async t => {
  // The new runtime is live while this slow session_start runs; the old reload has not finished.
  const pi = await startPi(t, `export default function(pi) {
    pi.on("session_start", async (event, ctx) => {
      if (event.reason !== "reload") return;
      ctx.ui.notify("slow-start", "info");
      await new Promise(resolve => setTimeout(resolve, 1500));
    });
  }`);
  const first = pi.request("prompt", { message: "/t3-reload" });
  await pi.waitForNotice("slow-start");
  await pi.request("prompt", { message: "/t3-reload" });
  await first;
  await pi.waitForNotice("Pi runtime reloaded.");
  await delay(2000);
  assert.equal(pi.notices("slow-start"), 1, JSON.stringify(pi.records));
  assert.equal(pi.notices("Reload already in progress."), 1);
  assert.equal(pi.records.filter(r => r.type === "extension_error").length, 0, JSON.stringify(pi.records));
  assert.equal(pi.records.filter(r => r.type === "agent_start").length, 0);
});
