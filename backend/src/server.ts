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
startTokenPruner(env.tokenPruneIntervalMs);
