/**
 * Thin wrapper over Sonner. Centralizes theme/positioning so components
 * stay decoupled from the toast library and we can swap it later without
 * touching callers.
 */

import { toast as sonnerToast } from "sonner";

export const toast = {
  success: (message: string, description?: string) =>
    sonnerToast.success(message, description ? { description } : undefined),
  error: (message: string, description?: string) =>
    sonnerToast.error(message, description ? { description } : undefined),
  info: (message: string, description?: string) =>
    sonnerToast.info(message, description ? { description } : undefined),
  warning: (message: string, description?: string) =>
    sonnerToast.warning(message, description ? { description } : undefined),
  loading: (message: string) => sonnerToast.loading(message),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  /** Promise helper — shows loading → success/error based on resolution. */
  promise: <T,>(
    promise: Promise<T>,
    opts: { loading: string; success: string | ((value: T) => string); error: string | ((err: unknown) => string) },
  ) => sonnerToast.promise(promise, opts),
};

export type Toast = typeof toast;
