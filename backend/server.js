import "dotenv/config";
import { app } from "./src/app.js";
import { env } from "./src/env.js";

app.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`);
});
