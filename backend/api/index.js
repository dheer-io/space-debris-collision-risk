// Vercel serverless entrypoint. An Express app is already a valid Node
// request handler ((req, res) => ...), so no adapter is needed — this file
// only exists because Vercel's Node runtime looks for a handler under api/.
// vercel.json rewrites every request here while preserving the original
// path, so app.js's own /api/... routes still match unchanged.
import { app } from "../src/app.js";

export default app;
