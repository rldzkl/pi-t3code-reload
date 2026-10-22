import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Reload loads a new copy of this extension before the old reload finishes, so the guard must outlive it.
// It is process-wide; T3 runs one Pi session per process.
const reloading = Symbol.for("pi-t3-reload.reloading");
const state = globalThis as unknown as Record<symbol, boolean | undefined>;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("t3-reload", {
    description: "Reload Pi resources without restarting T3 Code (idle sessions only)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (state[reloading]) {
        // Between invalidation and the new runtime, Pi still routes this command to the stale copy.
        try { ctx.ui.notify("Reload already in progress.", "warning"); } catch {}
        return;
      }
      if (args.trim()) {
        ctx.ui.notify("Usage: /t3-reload", "warning");
        return;
      }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        ctx.ui.notify("Pi is busy or has queued messages. Retry reload when idle.", "warning");
        return;
      }
      state[reloading] = true;
      try {
        await ctx.reload();
        // Reload invalidates this runtime. Do not use pi or ctx after it.
      } finally {
        state[reloading] = false;
      }
    },
  });
  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") ctx.ui.notify("Pi runtime reloaded.", "info");
  });
}
