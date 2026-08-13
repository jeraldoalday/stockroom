import { createApp } from "./app";
import { env } from "./lib/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`StockRoom API listening on port ${env.port}`);
});
