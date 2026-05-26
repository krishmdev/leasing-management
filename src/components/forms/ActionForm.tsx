"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/forms";
import { cx } from "@/lib/cx";

/**
 * A form bound to a server action with inline error state. Use from client components; the
 * render prop gets the last state so fields can show errors and keep what was typed.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  children: (state: FormState, pending: boolean) => ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={cx(className)} noValidate>
      {state?.message && (
        <div role={state.ok ? "status" : "alert"} className={cx("mb-4 rounded-md px-3.5 py-3 text-sm", state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad")}>
          {state.message}
        </div>
      )}
      {children(state, pending)}
    </form>
  );
}
