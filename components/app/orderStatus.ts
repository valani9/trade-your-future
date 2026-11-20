export const STATUS_STEPS = ["created", "funded", "handed_over", "released"] as const;

export const statusLabel = (status: string): string => {
  switch (status) {
    case "created":
      return "Claimed";
    case "funded":
      return "Paid";
    case "handed_over":
      return "Handed over";
    case "released":
      return "Complete";
    case "refunded":
      return "Refunded";
    case "disputed":
      return "In review";
    case "failed":
      return "Didn't go through";
    default:
      return status;
  }
};

export const stepLabel = (step: string): string => {
  switch (step) {
    case "created":
      return "Claimed";
    case "funded":
      return "Paid into escrow";
    case "handed_over":
      return "Handed over";
    case "released":
      return "Complete";
    default:
      return step;
  }
};
