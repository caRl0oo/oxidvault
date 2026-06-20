import { useEffect, useState } from "react";
import {
  copySecureToClipboard,
  subscribeSecureClipboard,
} from "@/lib/secureClipboard";

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

  const getLabel = (fieldId: string) => {
    if (activeField !== fieldId) return "Kopieren";
    return secondsLeft > 0 ? `Kopiert! (${secondsLeft}s)` : "Kopiert!";
  };

  return { copy, getLabel, activeField };
}
