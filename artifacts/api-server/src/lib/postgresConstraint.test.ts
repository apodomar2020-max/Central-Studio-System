import assert from "node:assert/strict";
import test from "node:test";

import { isPostgresConstraintViolation } from "./postgresConstraint";

const PHONE_CONSTRAINT = "uniq_students_phone";

test("recognises a raw node-postgres unique violation", () => {
  assert.equal(isPostgresConstraintViolation({ code: "23505", constraint: PHONE_CONSTRAINT }, PHONE_CONSTRAINT), true);
});

test("recognises a unique violation wrapped by Drizzle", () => {
  const error = new Error("Failed query");
  (error as Error & { cause: unknown }).cause = { code: "23505", constraint: PHONE_CONSTRAINT };
  assert.equal(isPostgresConstraintViolation(error, PHONE_CONSTRAINT), true);
});

test("supports drivers that expose constraint_name", () => {
  assert.equal(
    isPostgresConstraintViolation({ driverError: { code: "23505", constraint_name: PHONE_CONSTRAINT } }, PHONE_CONSTRAINT),
    true,
  );
});

test("does not misclassify another database constraint", () => {
  assert.equal(
    isPostgresConstraintViolation({ code: "23505", constraint: "students_email_unique" }, PHONE_CONSTRAINT),
    false,
  );
});
