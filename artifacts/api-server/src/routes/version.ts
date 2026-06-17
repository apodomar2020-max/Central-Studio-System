import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/version", (_req, res) => {
  res.json({
    version: "dance-types-build",
    commit:
      process.env["RAILWAY_GIT_COMMIT_SHA"] ??
      process.env["VERCEL_GIT_COMMIT_SHA"] ??
      "unknown",
    time: new Date().toISOString(),
    routes: ["dance-types"],
  });
});

export default router;
