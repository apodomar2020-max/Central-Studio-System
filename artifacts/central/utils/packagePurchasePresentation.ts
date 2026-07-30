export type PackagePurchaseErrorPresentation = {
  title: string;
  message: string;
  isNetworkFailure: boolean;
};

type ApiErrorLike = {
  data?: unknown;
};

function responseCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as ApiErrorLike).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

export function presentPackagePurchaseError(error: unknown): PackagePurchaseErrorPresentation {
  if (error instanceof TypeError) {
    return {
      title: "Connection Problem",
      message: "Please check your connection and try again.",
      isNetworkFailure: true,
    };
  }

  if (responseCode(error) === "PARTICIPANT_DOB_REQUIRED") {
    return {
      title: "Date of birth required",
      message: "Add this child’s date of birth before purchasing an age-restricted package.",
      isNetworkFailure: false,
    };
  }

  return {
    title: "Request Failed",
    message: "We couldn’t submit this package request. Please try again or contact the studio.",
    isNetworkFailure: false,
  };
}
