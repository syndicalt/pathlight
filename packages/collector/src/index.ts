import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { serve } from "@hono/node-server";
import { createDb, runMigrations } from "@pathlight/db";
import { KeyStore, loadSealKey, SealKeyError } from "@pathlight/keys";
import { createRouter } from "./router.js";

const port = parseInt(process.env.PORT || "4100", 10);
const hostname = process.env.PATHLIGHT_HOST || "127.0.0.1";
const accessToken = process.env.PATHLIGHT_ACCESS_TOKEN;

const db = createDb();
await runMigrations(db);

// Load the BYOK master key. FAIL-STOP on missing/malformed — never
// fall back to a default (parent invariant #4 from issue #44). If BYOK
// isn't needed yet, operators can skip key-store wiring by leaving
// PATHLIGHT_SEAL_KEY unset AND not calling the /v1/projects/:id/keys
// endpoints; here we require it when the env var is present to
// validate it early. Callers who want full BYOK set the var.
let keyStore: KeyStore | undefined;
if (process.env.PATHLIGHT_SEAL_KEY !== undefined) {
  try {
    const sealKey = loadSealKey();
    keyStore = new KeyStore(db, sealKey);
  } catch (err) {
    if (err instanceof SealKeyError) {
      // Log WITHOUT the env value (it's still in process.env, but we
      // must not echo it). Print the error message only.
      console.error(`[pathlight] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const isLocalHost = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
const displayHost = hostname === "0.0.0.0" ? "localhost" : hostname;
console.log(`Pathlight collector running on http://${displayHost}:${port}`);
if (!isLocalHost && !accessToken) {
  console.warn(
    "[pathlight] Collector is bound outside localhost without PATHLIGHT_ACCESS_TOKEN. " +
      "Only do this on a trusted network.",
  );
}
if (accessToken) {
  console.log("[pathlight] access token required for /v1 routes");
}
if (keyStore) {
  console.log("[pathlight] BYOK key store enabled");
}

const app = await createRouter({ db, keyStore, accessToken });
serve({ fetch: app.fetch, port, hostname });
