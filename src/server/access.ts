/**
 * The deployment's access list. Only these email addresses can create an account, sign in or stay signed in.
 * Set ALLOWED_EMAILS to a comma- or space-separated list. In production an unset list lets nobody in, so a
 * misconfigured deployment fails closed. In development and tests an unset list means no restriction.
 */
export function allowedEmails(): Set<string> | null {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return process.env.NODE_ENV === "production" ? new Set() : null;
  return new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function isEmailAllowed(email: string): boolean {
  const list = allowedEmails();
  return list === null || list.has(email.trim().toLowerCase());
}

export const NOT_ON_LIST = "This email address doesn't have access to this workspace.";
