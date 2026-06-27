import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, instructorsTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  CreateInstructorBody,
  GetInstructorParams,
  GetInstructorResponse,
  UpdateInstructorParams,
  UpdateInstructorBody,
  UpdateInstructorResponse,
  DeleteInstructorParams,
  ListInstructorsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const requireInstructorMediaPermission = (req: Request, res: Response, next: NextFunction): void => {
  if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, "photoUrl")) {
    next();
    return;
  }
  requireAdminPermission("instructors", "mediaManage")(req, res, next);
};

router.get("/instructors", async (req, res): Promise<void> => {
  const rows = await db.select().from(instructorsTable).orderBy(instructorsTable.createdAt);
  res.json(ListInstructorsResponse.parse(rows));
});

router.post("/instructors", blockStudentJwt, requireAdminAuth, requireAdminPermission("instructors", "create"), requireInstructorMediaPermission, async (req, res): Promise<void> => {
  const parsed = CreateInstructorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(instructorsTable).values(parsed.data).returning();
  res.status(201).json(GetInstructorResponse.parse(row));
});

router.get("/instructors/:id", async (req, res): Promise<void> => {
  const params = GetInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(instructorsTable).where(eq(instructorsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }
  res.json(GetInstructorResponse.parse(row));
});

router.patch("/instructors/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("instructors", "edit"), requireInstructorMediaPermission, async (req, res): Promise<void> => {
  const params = UpdateInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInstructorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(instructorsTable).set(parsed.data).where(eq(instructorsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }
  res.json(UpdateInstructorResponse.parse(row));
});

router.delete("/instructors/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("instructors", "delete"), async (req, res): Promise<void> => {
  const params = DeleteInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(instructorsTable).where(eq(instructorsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
