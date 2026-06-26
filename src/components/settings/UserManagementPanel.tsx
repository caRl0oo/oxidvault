// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddUserModal } from "@/components/settings/AddUserModal";
import { VaultButton } from "@/components/ui/VaultButton";
import { CONFIRM_PANEL_CLASS, STATUS_SUCCESS_CLASS } from "@/lib/uiClasses";
import { addVaultUser, getLicenseInfo, listVaultUsers, removeVaultUser } from "@/lib/ipc";
import { formatVaultError, isLicenseLimitError } from "@/lib/errors";
import { runAsync } from "@/lib/runAsync";
import type { LicenseInfo, UserRole, VaultUserPublic } from "@/types/vault";

const containerClass = "max-w-xl space-y-4";
const headingClass = "font-mono text-xs uppercase tracking-wider text-vault-muted";
const loadingClass = "font-mono text-sm text-vault-muted";
const userListClass =
  "divide-y divide-vault-border rounded-lg border border-vault-border/60 bg-vault-surface/30";
const userRowClass =
  "flex items-center justify-between gap-3 px-4 py-3 font-mono text-sm";
const usernameClass = "text-vault-text";
const roleClass = "ml-2 text-xs text-vault-muted";
const mfaBadgeClass = "ml-2 text-xs text-vault-accent";
const currentUserClass = "text-xs text-vault-accent";
const successClass = `${STATUS_SUCCESS_CLASS} px-3 py-2 text-xs`;
const errorClass = "font-mono text-xs text-vault-danger";
const confirmPanelClass = `${CONFIRM_PANEL_CLASS} p-4`;
const confirmTextClass = "font-mono text-xs leading-relaxed text-vault-muted";
const licenseHeaderClass = "mb-4 flex items-center gap-2";
const enterprisePlanBadgeClass =
  "rounded border border-green-700 bg-green-900 px-2 py-1 font-mono text-xs text-green-300";
const communityPlanBadgeClass =
  "rounded border border-vault-border bg-vault-surface/30 px-2 py-1 font-mono text-xs text-vault-muted";
const licenseMetaClass = "font-mono text-xs text-vault-muted";

function LicenseHeaderBadge({
  licenseInfo,
  userCount,
}: Readonly<{
  licenseInfo: LicenseInfo;
  userCount: number;
}>) {
  const { t } = useTranslation();
  const isEnterprise = licenseInfo.plan === "enterprise";
  const planBadgeClass = isEnterprise ? enterprisePlanBadgeClass : communityPlanBadgeClass;

  return (
    <div className={licenseHeaderClass}>
      <span className={planBadgeClass}>
        {isEnterprise ? t("license.enterpriseEdition") : t("license.communityEdition")}
      </span>
      {licenseInfo.plan === "community" ? (
        <span className={licenseMetaClass}>
          {t("license.userCount", { current: userCount, max: licenseInfo.ceMaxUsers })}
        </span>
      ) : null}
      {isEnterprise && licenseInfo.licensee ? (
        <span className={licenseMetaClass}>{licenseInfo.licensee}</span>
      ) : null}
    </div>
  );
}

export function UserManagementPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<VaultUserPublic[]>([]);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [licenseLimitReached, setLicenseLimitReached] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  useEffect(() => {
    getLicenseInfo()
      .then(setLicenseInfo)
      .catch((err: unknown) => {
        console.error(err);
      });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listVaultUsers();
      setUsers(list);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAsync(refresh);
  }, [refresh]);

  const ceMaxUsers = licenseInfo?.ceMaxUsers ?? 5;
  const atCeLimit =
    licenseInfo?.plan === "community" && users.length >= ceMaxUsers;

  const handleAdd = async (username: string, password: string, role: UserRole) => {
    setAddLoading(true);
    setError(null);
    try {
      await addVaultUser(username, password, role);
      setAddOpen(false);
      setLicenseLimitReached(false);
      setSuccess(t("users.addUserSuccess"));
      globalThis.setTimeout(() => setSuccess(null), 3000);
      await refresh();
    } catch (e) {
      if (isLicenseLimitError(e)) {
        setLicenseLimitReached(true);
        return;
      }
      setError(formatVaultError(e));
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemove = async (username: string) => {
    setRemoveLoading(true);
    setError(null);
    try {
      await removeVaultUser(username);
      setRemoveTarget(null);
      setSuccess(t("users.removeUserSuccess"));
      globalThis.setTimeout(() => setSuccess(null), 3000);
      await refresh();
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setRemoveLoading(false);
    }
  };

  const openAddModal = () => {
    setLicenseLimitReached(false);
    setAddOpen(true);
  };

  const roleLabel = (role: UserRole) =>
    role === "admin" ? t("users.roleAdmin") : t("users.roleMember");

  return (
    <div className={containerClass}>
      <h2 className={headingClass}>{t("users.title")}</h2>

      {licenseInfo ? <LicenseHeaderBadge licenseInfo={licenseInfo} userCount={users.length} /> : null}

      {loading ? (
        <p className={loadingClass}>{t("common.loading")}</p>
      ) : (
        <ul className={userListClass}>
          {users.map((user) => (
            <li key={user.username} className={userRowClass}>
              <div className="min-w-0">
                <span className={usernameClass}>{user.username}</span>
                <span className={roleClass}>{roleLabel(user.role)}</span>
                {user.mfaEnabled ? (
                  <span className={mfaBadgeClass}>{t("users.mfaEnabled")}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {user.isCurrentUser ? (
                  <span className={currentUserClass}>{t("users.currentUser")}</span>
                ) : (
                  <VaultButton
                    variant="outline"
                    tone="danger"
                    size="sm"
                    onClick={() => setRemoveTarget(user.username)}
                  >
                    {t("users.removeUser")}
                  </VaultButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <VaultButton
        variant="primary"
        size="sm"
        onClick={openAddModal}
        disabled={atCeLimit}
        title={atCeLimit ? t("license.limitReached") : undefined}
      >
        + {t("users.addUser")}
      </VaultButton>

      {success ? <p className={successClass}>{success}</p> : null}
      {error ? (
        <p className={errorClass} role="alert">
          {error}
        </p>
      ) : null}

      {removeTarget ? (
        <div className={confirmPanelClass}>
          <p className={confirmTextClass}>
            {t("users.removeUserConfirm", { username: removeTarget })}
          </p>
          <div className="mt-3 flex gap-2">
            <VaultButton
              variant="ghost"
              size="sm"
              onClick={() => setRemoveTarget(null)}
              disabled={removeLoading}
            >
              {t("common.cancel")}
            </VaultButton>
            <VaultButton
              variant="outline"
              tone="danger"
              size="sm"
              onClick={() => runAsync(() => handleRemove(removeTarget))}
              disabled={removeLoading}
            >
              {removeLoading ? t("common.pleaseWait") : t("users.removeUser")}
            </VaultButton>
          </div>
        </div>
      ) : null}

      <AddUserModal
        open={addOpen}
        loading={addLoading}
        licenseLimitReached={licenseLimitReached}
        onClose={() => setAddOpen(false)}
        onSubmit={(username, password, role) => {
          void handleAdd(username, password, role);
        }}
      />
    </div>
  );
}
