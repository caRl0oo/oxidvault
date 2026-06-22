import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MODAL_PANEL_CLASS } from "@/lib/uiClasses";

interface OverlayModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ariaLabel: string;
  readonly ariaLabelledBy?: string;
  readonly closeDisabled?: boolean;
  readonly closeLabel: string;
  readonly panelClassName?: string;
  readonly children: ReactNode;
}

const OVERLAY_DIALOG_CLASS =
  "fixed inset-0 z-[100] m-0 flex h-full max-h-none w-full max-w-none border-0 bg-transparent p-0";

/** Full-screen overlay modal portaled to document.body (reliable in Tauri WebView2). */
export function OverlayModal({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  closeDisabled = false,
  closeLabel,
  panelClassName = "max-w-lg",
  children,
}: Readonly<OverlayModalProps>) {
  if (!open) {
    return null;
  }

  const handleBackdropClose = () => {
    if (closeDisabled) {
      return;
    }
    onClose();
  };

  return createPortal(
    <dialog
      open
      className={OVERLAY_DIALOG_CLASS}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onCancel={(event) => {
        if (closeDisabled) {
          event.preventDefault();
        }
      }}
      onClose={onClose}
    >
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 z-0 cursor-default border-0 bg-vault-overlay p-0 backdrop-blur-sm"
        onClick={handleBackdropClose}
        disabled={closeDisabled}
      />
      <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className={`${MODAL_PANEL_CLASS} pointer-events-auto w-full ${panelClassName}`}>
          {children}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
