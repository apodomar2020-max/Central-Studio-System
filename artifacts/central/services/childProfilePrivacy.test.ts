import assert from "node:assert/strict";
import test from "node:test";
import { stripSensitiveChildFields } from "./childProfilePrivacy";

test("17/18: medical/emergency fields are stripped before the cache write, other fields survive", () => {
  const input = [
    {
      id: "1",
      fullName: "Amira",
      dateOfBirth: "2015-04-01",
      birthday: "2015-04-01",
      age: 10,
      gender: "female" as const,
      medicalNotes: "Peanut allergy, carries an EpiPen",
      emergencyContactName: "Sara (mother)",
      emergencyContactPhone: "+971500000000",
    },
  ];

  const stripped = stripSensitiveChildFields(input);

  assert.equal(stripped.length, 1);
  const row = stripped[0] as Record<string, unknown>;
  assert.equal("medicalNotes" in row, false, "medical notes must never reach the AsyncStorage cache");
  assert.equal("emergencyContactName" in row, false, "emergency contact name must never reach the AsyncStorage cache");
  assert.equal("emergencyContactPhone" in row, false, "emergency contact phone must never reach the AsyncStorage cache");

  // 19: non-sensitive fields still persist normally.
  assert.equal(row.id, "1");
  assert.equal(row.fullName, "Amira");
  assert.equal(row.dateOfBirth, "2015-04-01");
  assert.equal(row.age, 10);
  assert.equal(row.gender, "female");
});

test("children with no sensitive fields set pass through unchanged (besides the key removal)", () => {
  const input = [{ id: "2", fullName: "Yousef", birthday: "2018-01-01", age: 7, gender: "male" as const }];
  const stripped = stripSensitiveChildFields(input);
  assert.deepEqual(stripped, input);
});

test("empty list stays empty", () => {
  assert.deepEqual(stripSensitiveChildFields([]), []);
});
