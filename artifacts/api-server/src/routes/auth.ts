/**
 * Authentication routes — /api/auth/*
 *
 * These routes are still protected by the API key middleware (the shared app
 * secret baked into the APK), but they additionally handle user-level
 * credentials (email + password) for registration and login.
 *
 * POST /api/auth/register  — create a new student account
 * POST /api/auth/login     — verify credentials, return student data
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RegisterBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const LoginBody = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// POST /api/auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { name, email, phone, password } = parsed.data;

  // Check if email is already taken
  const [existing] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.email, email.toLowerCase().trim()));

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [student] = await db
    .insert(studentsTable)
    .values({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() ?? null,
      passwordHash,
    })
    .returning({
      id: studentsTable.id,
      name: studentsTable.name,
      email: studentsTable.email,
      phone: studentsTable.phone,
      emailVerified: studentsTable.emailVerified,
      joinedAt: studentsTable.joinedAt,
    });

  logger.info({ studentId: student.id }, "New student registered");

  res.status(201).json({ student });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.email, email.toLowerCase().trim()));

  if (!student) {
    // Return a generic message to avoid leaking whether the email exists
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!student.passwordHash) {
    // Student was created by admin without a password — they need to register
    res.status(401).json({ error: "No password set for this account. Please register." });
    return;
  }

  const valid = await bcrypt.compare(password, student.passwordHash);
  if (!valid) {
    logger.warn({ email }, "Failed login attempt");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  logger.info({ studentId: student.id }, "Student logged in");

  res.json({
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
      emailVerified: student.emailVerified,
      joinedAt: student.joinedAt,
    },
  });
});

export default router;
