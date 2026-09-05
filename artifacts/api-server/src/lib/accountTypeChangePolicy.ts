export type AccountTypeChangeLockReason = "child_class_booking" | "ballet_application";

export type AccountTypeChangePolicy = {
  locked: boolean;
  reasons: AccountTypeChangeLockReason[];
  message: string | null;
};

export function evaluateAccountTypeChangePolicy(input: {
  hasChildClassBooking: boolean;
  hasBalletApplication: boolean;
}): AccountTypeChangePolicy {
  const reasons: AccountTypeChangeLockReason[] = [];
  if (input.hasChildClassBooking) reasons.push("child_class_booking");
  if (input.hasBalletApplication) reasons.push("ballet_application");

  const message = reasons.length === 2
    ? "Account type cannot be changed because this account has child class bookings and a ballet application."
    : reasons[0] === "child_class_booking"
      ? "Account type cannot be changed because a child has an existing class booking."
      : reasons[0] === "ballet_application"
        ? "Account type cannot be changed because this account has a ballet application."
        : null;

  return {
    locked: reasons.length > 0,
    reasons,
    message,
  };
}
