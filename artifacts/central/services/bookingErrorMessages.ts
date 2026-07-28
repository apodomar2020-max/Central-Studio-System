export type BookingErrorMessage = {
  title: string;
  message: string;
};

const BOOKING_ERROR_MESSAGES: Record<string, BookingErrorMessage> = {
  DOB_REQUIRED: {
    title: "Date of birth required",
    message: "Complete this participant's date of birth before booking so we can confirm class eligibility.",
  },
  DOB_INVALID: {
    title: "Date of birth needs attention",
    message: "This participant's date of birth is invalid. Update the profile and try again.",
  },
  DOB_FUTURE: {
    title: "Date of birth needs attention",
    message: "This participant's date of birth cannot be in the future. Update the profile and try again.",
  },
  AGE_BELOW_MINIMUM: {
    title: "Participant is too young",
    message: "This class is for an older age range. Choose another class or participant.",
  },
  AGE_ABOVE_MAXIMUM: {
    title: "Participant is above the age range",
    message: "This class is for a younger age range. Choose another class or participant.",
  },
  PACKAGE_PARTICIPANT_MISMATCH: {
    title: "Package belongs to another participant",
    message: "Choose a package assigned to this participant, or continue with Pay at Studio.",
  },
  PACKAGE_CREDIT_INTEGRITY_MISMATCH: {
    title: "Package temporarily unavailable",
    message: "We couldn't verify this package credit. Choose Pay at Studio or contact the studio.",
  },
  PACKAGE_EXPIRED: {
    title: "Package expires before this class",
    message: "This package cannot cover the selected class date. Choose Pay at Studio or another valid package.",
  },
  PACKAGE_DANCE_TYPE_MISMATCH: {
    title: "Package not valid for this dance style",
    message: "Choose Pay at Studio or a package that includes this dance style.",
  },
  PACKAGE_NO_CREDITS: {
    title: "No package credits available",
    message: "This participant has no usable credits in the selected package. Choose Pay at Studio to continue.",
  },
  schedule_capacity_full: {
    title: "Class is full",
    message: "This class occurrence has reached capacity. Please choose another schedule.",
  },
  OCCURRENCE_INVALID: {
    title: "Schedule unavailable",
    message: "This class occurrence is no longer valid. Please choose another schedule.",
  },
};

export function getBookingErrorMessage(code: string | null | undefined): BookingErrorMessage | null {
  return code ? BOOKING_ERROR_MESSAGES[code] ?? null : null;
}
