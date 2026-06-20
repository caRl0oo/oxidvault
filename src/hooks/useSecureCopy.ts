import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/ipc";
import {
  copySecureToClipboard,
  notifyBackendSecureCopy,
  subscribeSecureClipboard,
} from "@/lib/secureClipboard";
import type { SecretField } from "@/types/vault";

export function useSecureCopy() {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    return subscribeSecureClipboard(({ active, secondsLeft: sec }) => {
      if (!active) {
        setActiveField(null);
        setSecondsLeft(0);
      } else {
        setSecondsLeft(sec);
      }
    });
  }, []);

  const copy = async (fieldId: string, value: string) => {
    const ok = await copySecureToClipboard(value);
    if (ok) setActiveField(fieldId);
    return ok;
  };

  const copySecret = async (
    fieldId: string,
    entryId: string,
    field: SecretField = "primary",
  ) => {
    await copyToClipboard(entryId, field);
    notifyBackendSecureCopy();
    setActiveField(fieldId);
    return true;
  };

  const getLabel = (fieldId: string) => {
    if (activeField !== fieldId) return "Kopieren";
    return secondsLeft > 0 ? `Kopiert! (${secondsLeft}s)` : "Kopiert!";
  };

  return { copy, copySecret, getLabel, activeField };
}
