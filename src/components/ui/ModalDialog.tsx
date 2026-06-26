// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MODAL_DIALOG_CLASS } from "@/lib/uiClasses";

interface ModalDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly ariaLabelledBy: string;
  readonly children: ReactNode;
  readonly closeDisabled?: boolean;
  readonly zIndexClass?: string;
}

export function ModalDialog({
  open,
  onClose,
  ariaLabelledBy,
  children,
  closeDisabled = false,
  zIndexClass = "z-[60]",
}: Readonly<ModalDialogProps>) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ignoreCloseRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }

    if (!open && dialog.open) {
      ignoreCloseRef.current = true;
      dialog.close();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleBackdropClose = () => {
    if (closeDisabled) {
      return;
    }
    dialogRef.current?.close();
  };

  const handleDialogClose = () => {
    if (ignoreCloseRef.current) {
      ignoreCloseRef.current = false;
      return;
    }
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`${MODAL_DIALOG_CLASS} ${zIndexClass}`}
      onCancel={(event) => {
        if (closeDisabled) {
          event.preventDefault();
        }
      }}
      onClose={handleDialogClose}
      aria-labelledby={ariaLabelledBy}
    >
      <button
        type="button"
        aria-label={t("common.closeDialog")}
        className="absolute inset-0 z-0 h-full w-full cursor-default border-0 bg-transparent p-0"
        onClick={handleBackdropClose}
        disabled={closeDisabled}
      />
      <div className="relative z-10">{children}</div>
    </dialog>
  );
}
