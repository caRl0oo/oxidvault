// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import type { SecretKind } from "@/types/vault";

interface SecretTypeIconProps {
  readonly kind: SecretKind;
  readonly className?: string;
}

type IconRenderer = (className: string) => ReactNode;

const ICONS: Record<SecretKind, IconRenderer> = {
  web_login: (className) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  ),
  ssh_key: (className) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="5" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7.5 8H14M11 6v4M13 7v2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ),
  api_token: (className) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8h6M8 6v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  database: (className) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <ellipse cx="8" cy="4.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  network_wifi: (className) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 10c3-2.5 9-2.5 12 0M4.5 12.5c2-1.5 5.5-1.5 7.5 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="14" r="1" fill="currentColor" />
    </svg>
  ),
  secure_note: (className) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

export function SecretTypeIcon({ kind, className = "h-4 w-4" }: Readonly<SecretTypeIconProps>) {
  return ICONS[kind](className);
}
