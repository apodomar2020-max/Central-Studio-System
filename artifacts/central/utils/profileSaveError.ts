import { presentUserFacingError, userFacingErrorCode } from "./userFacingError";

export function profileSaveErrorCode(error: unknown): string | null {
  return userFacingErrorCode(error);
}

/** Converts profile-save failures into clear copy without leaking internals. */
export function presentProfileSaveError(error: unknown): string {
  switch (profileSaveErrorCode(error)) {
    case "PHONE_ALREADY_IN_USE":
      return "This phone number is already associated with another account.";
    case "PHONE_INVALID":
      return "Please enter a valid Egyptian mobile number.";
    case "ACCOUNT_TYPE_CHANGE_LOCKED":
      return "Account type cannot be changed while this account has child class or ballet activity.";
  }

  return presentUserFacingError(error, "We couldn’t save your profile right now. Please try again.");
}
