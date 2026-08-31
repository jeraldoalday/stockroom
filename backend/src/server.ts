import { createApp } from "./app";
import { env } from "./lib/env";
import { startTokenPruner } from "./lib/tokenPruning";

const app = createApp();

app.listen(env.port, () => {
  console.log(`StockRoom API listening on port ${env.port}`);
});

// Expired token rows are deleted on a timer rather than on a request, so
// nobody signing in waits behind a table-wide delete. See lib/tokenPruning
// for what is safe to delete and what deliberately isn't.
//
// TOKEN_PRUNE_INTERVAL_MS=0 turns this off. Behind a load balancer, every
// instance running this timer sweeps redundantly (harmless, since a delete
// on an already-deleted row is a no-op, but still duplicated work) — set it
// to 0 on every instance and run `npm run prune:tokens` from cron instead,
// once, for the whole deployment. See docs/DEPLOYMENT.md for a copy-paste
// cron/systemd recipe.
if (env.tokenPruneIntervalMs > 0) {
  startTokenPruner(env.tokenPruneIntervalMs);
} else {
  console.log("TOKEN_PRUNE_INTERVAL_MS=0 — in-process token pruning disabled; run `npm run prune:tokens` from cron instead.");
}
