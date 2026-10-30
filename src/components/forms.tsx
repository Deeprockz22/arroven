"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A form bound to a server action, showing its error or confirmation inline. */
export function ActionForm({
  action, children, className, reset = false, quiet = false,
}: { action: Action; children: React.ReactNode; className?: string; reset?: boolean; quiet?: boolean }) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (reset && state?.ok && ref.current) ref.current.reset();
  }, [state, reset]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p className="msg-error basis-full" role="alert">{state.error}</p>}
      {!quiet && state?.ok && <p className="msg-ok basis-full" role="status">{state.ok}</p>}
      {state?.data?.link && (
        <p className="msg-info basis-full break-all">
          <span className="mono select-all">{state.data.link}</span>
        </p>
      )}
    </form>
  );
}

export function Submit({ children, className = "btn btn-primary", pendingText, name, value }: {
  children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

/** A destructive or irreversible submit that asks for a second click. */
export function ConfirmSubmit({ children, confirmText, className = "btn", name, value }: {
  children: React.ReactNode; confirmText: string; className?: string; name?: string; value?: string;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();
  if (!armed) return <button type="button" className={className} onClick={() => setArmed(true)}>{children}</button>;
  return (
    <span className="inline-flex gap-2">
      <button type="submit" className="btn btn-danger btn-sm" disabled={pending} name={name} value={value}>{pending ? "Working…" : confirmText}</button>
      <button type="button" className="btn btn-sm" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => {})}
    >
      {done ? "Copied" : label}
    </button>
  );
}
