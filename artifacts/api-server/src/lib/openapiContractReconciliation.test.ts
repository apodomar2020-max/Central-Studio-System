import assert from "node:assert/strict";
import test from "node:test";
import {
  AdjustCreditsBody,
  CheckInQrBody,
  CheckInQrResponse,
  CreateDanceTypeBody,
  GetMyAttendanceResponse,
  GetMyCreditsResponse,
  ListCreditTransactionsResponse,
  ListStudentsQueryParams,
  ListStudentsResponse,
  UpdateDanceTypeBody,
} from "@workspace/api-zod";

test("student list query and response match the active paginated route", () => {
  assert.equal(ListStudentsQueryParams.safeParse({
    accountType: "parent",
    search: "sample",
    page: "2",
    pageSize: "25",
  }).success, true);

  assert.equal(ListStudentsResponse.safeParse({
    students: [{
      id: 1,
      name: "Sample",
      email: "sample@example.invalid",
      phone: null,
      notes: null,
      avatarUrl: null,
      totalBookings: 0,
      joinedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      accountType: "parent",
      childCount: 1,
      children: [{
        id: 2,
        fullName: "Child",
        birthday: null,
        age: null,
        gender: "unspecified",
        medicalNotes: null,
        emergencyName: null,
        emergencyPhone: null,
      }],
    }],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  }).success, true);
});

test("QR check-in contract preserves UUID and positive integer validation", () => {
  assert.equal(CheckInQrBody.safeParse({
    qrToken: "d9428888-122b-11e1-b85c-61cd3cbb3210",
    bookingId: 1,
    paymentMode: "package_credit",
    packageOrderId: 2,
  }).success, true);
  assert.equal(CheckInQrBody.safeParse({
    qrToken: "not-a-uuid",
    bookingId: 0,
    paymentMode: "package_credit",
  }).success, false);
  assert.equal(CheckInQrResponse.safeParse({
    attendanceId: 1,
    studentName: "Sample",
    studentEmail: "sample@example.invalid",
    classTitle: null,
    creditDeducted: true,
    remainingCredits: 3,
    checkedInAt: "2026-01-01T00:00:00.000Z",
  }).success, true);
});

test("credit ledger, adjustment, and my-route response envelopes remain compatible", () => {
  const transaction = {
    id: 1,
    packageOrderId: 2,
    studentId: 3,
    type: "deduction",
    delta: -1,
    balanceBefore: 5,
    balanceAfter: 4,
    referenceId: 4,
    referenceType: "booking",
    notes: null,
    createdBy: "system",
    className: "Sample",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const envelope = { data: [transaction], total: 1, page: 1, limit: 50 };

  assert.equal(ListCreditTransactionsResponse.safeParse(envelope).success, true);
  assert.equal(GetMyCreditsResponse.safeParse(envelope).success, true);
  assert.equal(AdjustCreditsBody.safeParse({
    type: "manual_adjustment",
    delta: 1,
    notes: "Correction",
  }).success, true);
  assert.equal(AdjustCreditsBody.safeParse({
    type: "manual_adjustment",
    delta: 1.5,
  }).success, false);
  assert.equal(AdjustCreditsBody.safeParse({
    type: "manual_adjustment",
    delta: 0,
  }).success, false);

  assert.equal(GetMyAttendanceResponse.safeParse({
    data: [{
      id: 1,
      studentEmail: "sample@example.invalid",
      studentName: "Sample",
      classTitle: "Sample class",
      status: "present",
      creditDeducted: true,
      checkedInAt: "2026-01-01T00:00:00.000Z",
      packageOrderId: 2,
      classId: 3,
      scheduleId: 4,
      notes: null,
      instructorName: null,
    }],
    total: 1,
    page: 1,
    limit: 50,
  }).success, true);
});

test("dance-type create and update schemas preserve active admin fields", () => {
  assert.equal(CreateDanceTypeBody.safeParse({
    name: "Contemporary",
    color: "#123abc",
    isActive: true,
    sortOrder: 1,
  }).success, true);
  assert.equal(UpdateDanceTypeBody.safeParse({
    description: null,
    coverImageUrl: null,
    color: "#fff",
  }).success, true);
  assert.equal(CreateDanceTypeBody.safeParse({
    name: "",
    color: "blue",
  }).success, false);
});
