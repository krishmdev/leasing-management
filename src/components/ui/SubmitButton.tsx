"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClass } from "./index";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { pendingLabel?: string; variant?: "primary" | "secondary" | "brand" | "danger" | "ghost"; size?: "sm" | "md" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || rest.disabled} aria-busy={pending} className={buttonClass(variant, size, className)} {...rest}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
