// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { Gear } from "@phosphor-icons/react";

export function GearIcon({ className }: Readonly<{ className?: string }>) {
  return <Gear weight="light" className={className} aria-hidden />;
}
