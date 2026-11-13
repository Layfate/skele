import { LocalError } from "@/data/common";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "QuotaExceededError") return "Your device is out of storage space for Skele.";
    return error.message;
  }
  return "Something went wrong";
}

export const isNotFound = (error: unknown) => error instanceof LocalError && error.code === "not_found";
