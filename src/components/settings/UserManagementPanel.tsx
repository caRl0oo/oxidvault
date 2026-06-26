// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddUserModal } from "@/components/settings/AddUserModal";
import { VaultButton } from "@/components/ui/VaultButton";
import { CONFIRM_PANEL_CLASS, STATUS_SUCCESS_CLASS, UI } from "@/lib/uiClasses";
import { addVaultUser, getLicenseInfo, listVaultUsers, removeVaultUser } from "@/lib/ipc";
import { formatVaultError, isLicenseLimitError } from "@/lib/errors";
import { openWebsiteUrl } from "@/lib/openWebsite";
import { runAsync } from "@/lib/runAsync";
import type { LicenseInfo, UserRole, VaultUserPublic } from "@/types/vault";

const containerClass = "max-w-xl space-y-4";
const headingClass = UI.sectionLabel;
const loadingClass = "text-sm text-vault-muted";
const userListClass = `${UI.card} divide-y divide-vault-border p-0`;
const userRowClass = "flex items-center justify-between gap-3 px-4 py-3 text-sm";
const usernameClass = "text-vault-text";
const roleClass = "ml-2 text-xs text-vault-muted";
const mfaBadgeClass = "ml-2 text-xs text-vault-accent";
const currentUserClass = "text-xs text-vault-accent";
const successClass = `${STATUS_SUCCESS_CLASS} px-3 py-2 text-xs`;
const errorClass = "text-xs text-vault-danger";
const confirmPanelClass = `${CONFIRM_PANEL_CLASS} p-4`;
const confirmTextClass = "text-xs leading-relaxed text-vault-muted";
const licenseHeaderClass = "mb-4 flex items-center gap-2";
const licenseMetaClass = "text-xs text-vault-muted";
const upgradeTextBlockClass = "flex flex-col gap-1";
const upgradeTitleClass = "text-xs font-semibold text-vault-text";
const upgradeDescClass = "text-xs text-vault-muted";
const enterprisePlanBadgeClass =
  "rounded-lg border border-vault-success/40 bg-vault-success-subtle px-2 py-1 text-xs text-vault-success";
const communityPlanBadgeClass =
  "rounded-lg border border-vault-border bg-vault-bg px-2 py-1 text-xs text-vault-muted";
const upgradeBannerClass = `${UI.card} mt-6 flex items-center justify-between gap-4`;
const upgradeCtaClass = `${UI.btnSecondary} shrink-0 whitespace-nowrap text-xs text-vault-accent`;
const limitWarningClass = "mt-2 text-xs text-vault-warning";

const UPGRADE_URL = "https://oxidvault.com";

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

function CommunityUpgradeBanner({
  userCount,
  ceMaxUsers,
}: Readonly<{
  userCount: number;
  ceMaxUsers: number;
}>) {
  const { t } = useTranslation();
  const showLimitWarning = userCount >= ceMaxUsers - 1;

  return (
    <>
      <div className={upgradeBannerClass}>
        <div className={upgradeTextBlockClass}>
          <span className={upgradeTitleClass}>{t("license.upgradeTitle")}</span>
          <span className={upgradeDescClass}>{t("license.upgradeDesc")}</span>
        </div>
        <button
          type="button"
          onClick={() => runAsync(() => openWebsiteUrl(UPGRADE_URL))}
          className={upgradeCtaClass}
        >
          {t("license.upgradeButton")}
        </button>
      </div>
      {showLimitWarning ? (
        <p className={limitWarningClass}>
          {t("license.limitWarning", { current: userCount, max: ceMaxUsers })}
        </p>
      ) : null}
    </>
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

      {licenseInfo?.plan === "community" ? (
        <CommunityUpgradeBanner userCount={users.length} ceMaxUsers={ceMaxUsers} />
      ) : null}

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
