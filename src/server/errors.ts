export type AppErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid" | "conflict" | "limit";

/** An error whose message is written for the person using the app and safe to show them. */
export class AppError extends Error {
  constructor(public code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
