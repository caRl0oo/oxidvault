import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/ipc";
import {
  copySecureToClipboard,
  notifyBackendSecureCopy,
  subscribeSecureClipboard,
} from "@/lib/secureClipboard";
import type { SecretField } from "@/types/vault";

export function useSecureCopy() {
  const { t } = useTranslation();
  const [activeField, setActiveField] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    return subscribeSecureClipboard(({ active, secondsLeft: sec }) => {
      if (active) {
        setSecondsLeft(sec);
      } else {
        setActiveField(null);
        setSecondsLeft(0);
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

  const isCopied = (fieldId: string) => activeField === fieldId;

  const getLabel = (fieldId: string) => {
    if (activeField !== fieldId) return t("copy.copy");
    return secondsLeft > 0
      ? t("copy.copiedWithTimer", { seconds: secondsLeft })
      : t("copy.copied");
  };

  return { copy, copySecret, getLabel, isCopied, activeField };
}
