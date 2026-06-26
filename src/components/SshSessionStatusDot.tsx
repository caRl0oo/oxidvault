// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import type { SshSessionStatus } from "@/types/ssh";

interface SshSessionStatusDotProps {
  readonly status: SshSessionStatus | null;
  readonly size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
} as const;

function statusColorClass(status: SshSessionStatus): string {
  if (status === "connecting") {
    return "bg-vault-muted animate-pulse";
  }
  if (status === "active") {
    return "bg-vault-success shadow-[0_0_5px_1px] shadow-vault-success/60";
  }
  return "bg-vault-muted";
}

export function SshSessionStatusDot({
  status,
  size = "sm",
}: Readonly<SshSessionStatusDotProps>) {
  const { t } = useTranslation();

  if (!status) {
    return null;
  }

  const title = t(`ssh.status.${status}`);

  return (
    <output
      className={`inline-block shrink-0 rounded-full ${SIZE_CLASS[size]} ${statusColorClass(status)}`}
      title={title}
      aria-label={title}
    />
  );
}
