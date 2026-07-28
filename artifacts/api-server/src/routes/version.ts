import { Router, type IRouter } from "express";
import { resolveCodeCommit } from "../lib/codeCommit";

const router: IRouter = Router();

router.get("/version", async (_req, res) => {
  const codeCommit = await resolveCodeCommit();
  res.json({
    version: "dance-types-build",
    commit: codeCommit,
    codeCommit,
    time: new Date().toISOString(),
    routes: ["dance-types"],
  });
});

export default router;
