import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppScreenContent, BrowserPreview } from "@/components/AppScreenContent";
import { Layout } from "@/components/Layout";
import { AppMainArea } from "@/components/app/AppMainArea";
import { AppVaultStatus } from "@/components/app/AppVaultStatus";
import {
  SshHostKeyMismatchDialog,
  SshUnknownHostDialog,
} from "@/components/SshHostKeyDialogs";
import type { SettingsCategory } from "@/components/settings/types";
import { evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useExtensionPrefillListener } from "@/hooks/useExtensionPrefillListener";
import { useMfaRateLimit } from "@/hooks/useMfaRateLimit";
import { useReachabilityPolling } from "@/hooks/useReachabilityPolling";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useVaultLockedListener } from "@/hooks/useVaultLockedListener";
import { pickVaultOpenPath, pickVaultSavePath } from "@/lib/dialog";
import { formatVaultError, isInvalidMfaError } from "@/lib/errors";
import { runAsync } from "@/lib/runAsync";
import { cancelSecureClipboardClear, notifyBackendSecureCopy } from "@/lib/secureClipboard";
import { vaultLockMessage, resolveIdleLockSeconds } from "@/lib/vaultLockMessages";
import { filterEntries } from "@/lib/search";
import { openWebsiteUrl } from "@/lib/openWebsite";
import { estimateInitialPtySize } from "@/lib/sshTerminalLayout";
import {
  clearSshHostFingerprint,
  sshConnect,
  sshDisconnect,
  sshRejectHost,
  sshTrustHost,
} from "@/lib/ssh";
import {
  addEntry,
  bootstrapVault,
  copyToClipboard,
  createVault,
  detachVault,
  getAppSettings,
  getEntry,
  getResolvedConfig,
  getVaultInfo,
  healthCheck,
  isTauri,
  listEntries,
  lockVault,
  openVault,
  triggerGitSync,
  unlockVault,
  updateEntry,
  deleteEntry,
  takeExtensionNewSecret,
} from "@/lib/ipc";
import type { ResolvedConfig } from "@/types/policy";
import type { GitSyncSettings } from "@/types/settings";
import type { DashboardFilter } from "@/types/dashboardFilter";
import type {
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretEntrySummary,
  VaultInfo,
} from "@/types/vault";
import type {
  SshHostKeyMismatchState,
  SshPendingHostState,
  SshSessionStatus,
  SshTerminalState,
} from "@/types/ssh";

type Screen = "welcome" | "create" | "open" | "unlock" | "vault";
type VaultMainView = "secrets" | "security" | "activity";

export default function App() {
  const { t } = useTranslation();
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [backendStatus, setBackendStatus] = useState<string>(t("common.loading"));
  const [screen, setScreen] = useState<Screen>("welcome");
  const [password, setPassword] = useState("");
  const [vaultName, setVaultName] = useState(() => t("app.defaultVaultName"));
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<SecretEntrySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<SecretEntryPublic | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSecretPrefillPassword, setNewSecretPrefillPassword] = useState<string | null>(
    null,
  );
  const [editEntry, setEditEntry] = useState<SecretEntryPublic | null>(null);
  const [showPasswordGenerator, setShowPasswordGenerator] = useState(false);
  const [generatorApply, setGeneratorApply] = useState<((pwd: string) => void) | null>(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter | null>(null);
  const [vaultMainView, setVaultMainView] = useState<VaultMainView>("secrets");
  const [sshTerminal, setSshTerminal] = useState<SshTerminalState | null>(null);
  const [sshPendingHost, setSshPendingHost] = useState<SshPendingHostState | null>(null);
  const [sshHostKeyMismatch, setSshHostKeyMismatch] = useState<SshHostKeyMismatchState | null>(
    null,
  );
  const [sshTrustLoading, setSshTrustLoading] = useState(false);
  const [sshConnecting, setSshConnecting] = useState(false);
  const [sshSessionStatus, setSshSessionStatus] = useState<SshSessionStatus | null>(null);
  const [sshFocusMode, setSshFocusMode] = useState(false);
  const [sidebarCopyingId, setSidebarCopyingId] = useState<string | null>(null);
  const [gitSyncSettings, setGitSyncSettings] = useState<GitSyncSettings>({ enabled: false });
  const [resolvedConfig, setResolvedConfig] = useState<ResolvedConfig | null>(null);
  const [gitSyncing, setGitSyncing] = useState(false);
  const [gitSyncError, setGitSyncError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  const [mfaChallengeActive, setMfaChallengeActive] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [idleWarningSeconds, setIdleWarningSeconds] = useState<number | null>(null);
  const {
    isLockedOut: mfaLockedOut,
    secondsRemaining: mfaLockoutSeconds,
    recordInvalidMfa,
    reset: resetMfaRateLimit,
  } = useMfaRateLimit();
  const passwordRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshEntries = useCallback(async () => {
    const list = await listEntries();
    setEntries(list);
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setBackendStatus(t("app.backendBrowserOnly"));
      return;
    }
    try {
      const [health, info, settings, resolved] = await Promise.all([
        healthCheck(),
        bootstrapVault(),
        getAppSettings(),
        getResolvedConfig(),
      ]);
      setBackendStatus(health);
      setVaultInfo(info);
      setResolvedConfig(resolved);
      setGitSyncSettings({
        enabled: resolved.gitSyncEnabled.value,
        remoteUrl: settings.gitSync.remoteUrl,
      });
      if (!info.initialized) {
        setScreen("welcome");
      } else if (info.locked) {
        setScreen("unlock");
      } else {
        setScreen("vault");
        await refreshEntries();
      }
    } catch {
      setBackendStatus(t("app.backendOffline"));
    }
  }, [refreshEntries, t]);

  useEffect(() => {
    runAsync(refresh);
  }, [refresh]);

  const handleGitSync = useCallback(async () => {
    setGitSyncing(true);
    setGitSyncError(null);
    try {
      const result = await triggerGitSync();
      if (result.vaultReloaded) {
        const info = await getVaultInfo();
        setVaultInfo(info);
        if (!info.locked) {
          await refreshEntries();
          if (selectedId) {
            const entry = await getEntry(selectedId);
            setSelectedEntry(entry);
          }
        }
      }
    } catch (e) {
      setGitSyncError(formatVaultError(e));
      globalThis.setTimeout(() => setGitSyncError(null), 5000);
    } finally {
      setGitSyncing(false);
    }
  }, [refreshEntries, selectedId]);

  const openSettings = useCallback((category: SettingsCategory = "general") => {
    setSettingsCategory(category);
    setSettingsOpen(true);
  }, []);

  const openGitSettings = useCallback(() => {
    openSettings("sync");
  }, [openSettings]);

  const handleGoToUnlockFromSettings = useCallback(() => {
    setSettingsOpen(false);
    if (vaultInfo?.initialized) {
      setScreen("unlock");
    } else {
      setScreen("welcome");
    }
  }, [vaultInfo?.initialized]);

  const vaultLocked = !vaultInfo || vaultInfo.locked;

  const handleGitSyncChange = useCallback((settings: GitSyncSettings) => {
    setGitSyncSettings(settings);
  }, []);

  const handleApplyDashboardFilter = useCallback((filter: DashboardFilter) => {
    setDashboardFilter(filter);
    setVaultMainView("secrets");
    setSelectedId(null);
    setSelectedEntry(null);
  }, []);

  const clearDashboardFilter = useCallback(() => {
    setDashboardFilter(null);
  }, []);

  const handleTagChange = useCallback((tag: string | null) => {
    setActiveTag(tag);
    if (tag === null) {
      setDashboardFilter(null);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!password.trim() || !evaluateMasterPassword(password).valid) return;
    setLoading(true);
    setError(null);
    try {
      const defaultName = `${vaultName.trim().replace(/\s+/g, "-").toLowerCase() || "vault"}.oxid`;
      const path = await pickVaultSavePath(defaultName);
      if (!path) {
        setLoading(false);
        return;
      }
      const info = await createVault(path, vaultName.trim() || t("app.defaultVaultName"), password);
      setVaultInfo(info);
      setVaultPath(path);
      setPassword("");
      setScreen("vault");
      await refreshEntries();
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [password, vaultName, refreshEntries, t]);

  const finishVaultUnlock = useCallback(
    async (info: VaultInfo) => {
      resetMfaRateLimit();
      setVaultInfo(info);
      setPassword("");
      setMfaCode("");
      setMfaChallengeActive(false);
      setScreen("vault");
      await refreshEntries();
    },
    [refreshEntries, resetMfaRateLimit],
  );

  const handleOpen = useCallback(async () => {
    if (!password.trim() || !vaultPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await openVault(vaultPath, password);
      setVaultInfo(result.vault);
      if (result.mfaRequired) {
        setMfaChallengeActive(true);
        return;
      }
      await finishVaultUnlock(result.vault);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [password, vaultPath, finishVaultUnlock]);

  const handleSwitchVault = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await detachVault();
      resetMfaRateLimit();
      setVaultInfo(null);
      setVaultPath(null);
      setPassword("");
      setMfaCode("");
      setMfaChallengeActive(false);
      setScreen("welcome");
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [resetMfaRateLimit]);

  const handleUnlock = useCallback(async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await unlockVault(password);
      setVaultInfo(result.vault);
      if (result.mfaRequired) {
        setMfaChallengeActive(true);
        return;
      }
      await finishVaultUnlock(result.vault);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [password, finishVaultUnlock]);

  const handleCompleteMfa = useCallback(async (codeOverride?: string) => {
    const code = codeOverride ?? mfaCode;
    if (code.length !== 6 || loading || !password.trim() || mfaLockedOut) return;
    setLoading(true);
    setError(null);
    try {
      const result =
        screen === "open" && vaultPath
          ? await openVault(vaultPath, password, code)
          : await unlockVault(password, code);
      setVaultInfo(result.vault);
      if (result.mfaRequired) {
        setError(formatVaultError("MFA code required"));
        return;
      }
      await finishVaultUnlock(result.vault);
    } catch (e) {
      if (isInvalidMfaError(e)) {
        recordInvalidMfa();
      }
      setError(formatVaultError(e));
      setMfaCode("");
    } finally {
      setLoading(false);
    }
  }, [
    mfaCode,
    finishVaultUnlock,
    loading,
    mfaLockedOut,
    password,
    screen,
    vaultPath,
    recordInvalidMfa,
  ]);

  const handleCancelMfaChallenge = useCallback(() => {
    setMfaChallengeActive(false);
    setMfaCode("");
    setError(null);
    if (screen === "open") {
      setVaultPath(null);
      setPassword("");
      setScreen("welcome");
    }
  }, [screen]);

  const applyLockedUi = useCallback((info: VaultInfo, message?: string) => {
    cancelSecureClipboardClear();
    resetMfaRateLimit();
    setVaultInfo(info);
    setEntries([]);
    setSelectedId(null);
    setSelectedEntry(null);
    setPassword("");
    setMfaCode("");
    setMfaChallengeActive(false);
    setShowAddForm(false);
    setEditEntry(null);
    setShowPasswordGenerator(false);
    setGeneratorApply(null);
    setSshTerminal(null);
    setSshPendingHost((prev) => {
      if (prev?.sessionId) {
        void sshRejectHost(prev.sessionId);
      }
      return null;
    });
    setSshHostKeyMismatch(null);
    setSshConnecting(false);
    setSshSessionStatus(null);
    setSshFocusMode(false);
    setDashboardFilter(null);
    setActiveTag(null);
    setScreen("unlock");
    setIdleWarningSeconds(null);
    setError(message ?? null);
  }, [resetMfaRateLimit]);

  const performLock = useCallback(async () => {
    cancelSecureClipboardClear();
    const info = await lockVault();
    applyLockedUi(info);
  }, [applyLockedUi]);

  const handleVaultLocked = useCallback(
    (payload: { reason: string; info: VaultInfo; autoLockSeconds?: number }) => {
      const seconds = resolveIdleLockSeconds(
        payload.autoLockSeconds,
        resolvedConfig?.autoLockSeconds.value,
      );
      applyLockedUi(payload.info, vaultLockMessage(payload.reason, seconds, t));
    },
    [applyLockedUi, resolvedConfig?.autoLockSeconds.value, t],
  );

  useVaultLockedListener(handleVaultLocked);

  const handleExtensionNewSecretPrefill = useCallback(async () => {
    const password = await takeExtensionNewSecret();
    if (password) {
      setNewSecretPrefillPassword(password);
      setShowAddForm(true);
    }
  }, []);

  useExtensionPrefillListener(handleExtensionNewSecretPrefill);

  const handleLock = useCallback(async () => {
    try {
      setError(null);
      await performLock();
    } catch (e) {
      setError(String(e));
    }
  }, [performLock]);

  const handleIdleWarning = useCallback((secondsRemaining: number) => {
    setIdleWarningSeconds(secondsRemaining);
  }, []);

  const clearIdleWarning = useCallback(() => {
    setIdleWarningSeconds(null);
  }, []);

  const vaultUnlocked = screen === "vault" && !!vaultInfo && !vaultInfo.locked;
  useAutoLock(vaultUnlocked, handleIdleWarning, clearIdleWarning);

  const openPasswordGenerator = useCallback((apply?: (pwd: string) => void) => {
    setGeneratorApply(apply ?? null);
    setShowPasswordGenerator(true);
  }, []);

  const handleSelectEntry = useCallback(async (id: string) => {
    setVaultMainView("secrets");
    setSelectedId(id);
    try {
      const entry = await getEntry(id);
      setSelectedEntry(entry);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleQuickConnect = useCallback(
    async (entryId: string) => {
      const entry = selectedEntry?.id === entryId ? selectedEntry : null;
      const title =
        entry?.title ?? entries.find((e) => e.id === entryId)?.title ?? t("entry.quickConnect");
      setSshConnecting(true);
      setSshSessionStatus("connecting");
      setSshFocusMode(false);
      setError(null);
      try {
        const { cols, rows } = estimateInitialPtySize();
        const response = await sshConnect(entryId, cols, rows);
        if (response.status === "connected") {
          setSshTerminal({ session: response.session, entryTitle: title, entryId });
          return;
        }
        if (response.status === "unknownHost") {
          setSshPendingHost({
            entryId,
            entryTitle: title,
            fingerprint: response.fingerprint,
            sessionId: response.sessionId,
            host: response.host,
            username: response.username,
          });
          setSshSessionStatus(null);
          return;
        }
        setSshHostKeyMismatch({ expected: response.expected, got: response.got });
        setSshSessionStatus(null);
      } catch (e) {
        setError(formatVaultError(e));
        setSshSessionStatus(null);
      } finally {
        setSshConnecting(false);
      }
    },
    [selectedEntry, entries, t],
  );

  const handleSidebarCopyPassword = useCallback(async (entryId: string) => {
    setSidebarCopyingId(entryId);
    setError(null);
    try {
      await copyToClipboard(entryId, "password");
      notifyBackendSecureCopy();
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setSidebarCopyingId(null);
    }
  }, []);

  const handleSidebarOpenWebsite = useCallback(async (summary: SecretEntrySummary) => {
    if (!summary.subtitle) return;
    setError(null);
    try {
      await openWebsiteUrl(summary.subtitle);
    } catch (e) {
      setError(formatVaultError(e));
    }
  }, []);

  const closeSecretForm = useCallback(() => {
    setShowAddForm(false);
    setEditEntry(null);
    setNewSecretPrefillPassword(null);
  }, []);

  const handleAddEntry = useCallback(
    async (input: SecretEntryInputFull) => {
      setLoading(true);
      setError(null);
      try {
        const summary = await addEntry(input);
        await refreshEntries();
        closeSecretForm();
        setVaultInfo((prev) =>
          prev ? { ...prev, entry_count: prev.entry_count + 1 } : prev,
        );
        await handleSelectEntry(summary.id);
      } catch (e) {
        setError(formatVaultError(e));
      } finally {
        setLoading(false);
      }
    },
    [refreshEntries, handleSelectEntry, closeSecretForm],
  );

  const handleUpdateEntry = useCallback(
    async (id: string, input: SecretEntryInputFull) => {
      setLoading(true);
      setError(null);
      try {
        await updateEntry(id, input);
        await refreshEntries();
        closeSecretForm();
        await handleSelectEntry(id);
      } catch (e) {
        setError(formatVaultError(e));
      } finally {
        setLoading(false);
      }
    },
    [refreshEntries, handleSelectEntry, closeSecretForm],
  );

  const syncGitAfterDelete = useCallback(async () => {
    try {
      const result = await triggerGitSync();
      if (result.vaultReloaded) {
        const info = await getVaultInfo();
        setVaultInfo(info);
      }
    } catch (syncErr) {
      setGitSyncError(formatVaultError(syncErr));
      globalThis.setTimeout(() => setGitSyncError(null), 5000);
    }
  }, []);

  const handleDeleteEntry = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        await deleteEntry(id);
        await refreshEntries();
        setSelectedId(null);
        setSelectedEntry(null);
        setVaultInfo((prev) =>
          prev ? { ...prev, entry_count: Math.max(0, prev.entry_count - 1) } : prev,
        );
        if (gitSyncSettings.enabled) {
          await syncGitAfterDelete();
        }
      } catch (e) {
        setError(formatVaultError(e));
      } finally {
        setLoading(false);
      }
    },
    [refreshEntries, gitSyncSettings.enabled, syncGitAfterDelete],
  );

  const startCreate = useCallback(() => {
    setError(null);
    setPassword("");
    setVaultPath(null);
    setScreen("create");
  }, []);

  const startOpen = useCallback(async () => {
    setError(null);
    setPassword("");
    const path = await pickVaultOpenPath();
    if (path) {
      setVaultPath(path);
      setScreen("open");
    }
  }, []);

  const backToWelcome = useCallback(() => {
    setScreen("welcome");
    setPassword("");
    setError(null);
  }, []);

  const backFromOpen = useCallback(() => {
    if (mfaChallengeActive) {
      handleCancelMfaChallenge();
      return;
    }
    setScreen("welcome");
    setPassword("");
    setVaultPath(null);
    setError(null);
  }, [mfaChallengeActive, handleCancelMfaChallenge]);

  const handleAuthSubmit = useCallback(() => {
    if (mfaChallengeActive) {
      runAsync(() => handleCompleteMfa());
      return;
    }
    if (screen === "open") {
      runAsync(handleOpen);
    } else if (screen === "unlock") {
      runAsync(handleUnlock);
    }
  }, [mfaChallengeActive, handleCompleteMfa, screen, handleOpen, handleUnlock]);

  const closePasswordGenerator = useCallback(() => {
    setShowPasswordGenerator(false);
    setGeneratorApply(null);
  }, []);

  const handleMfaAutoSubmit = useCallback(
    (code: string) => {
      void handleCompleteMfa(code);
    },
    [handleCompleteMfa],
  );

  const handleShowAddForm = useCallback(() => {
    setShowAddForm(true);
  }, []);

  const handleCloseSshTerminal = useCallback(() => {
    setSshTerminal((prev) => {
      if (prev?.session.sessionId) {
        void sshDisconnect(prev.session.sessionId);
      }
      return null;
    });
    setSshFocusMode(false);
    setSshSessionStatus(null);
  }, []);

  const handleRejectUnknownHost = useCallback(() => {
    const pending = sshPendingHost;
    setSshPendingHost(null);
    if (pending?.sessionId) {
      void sshRejectHost(pending.sessionId);
    }
  }, [sshPendingHost]);

  const handleTrustUnknownHost = useCallback(async () => {
    if (!sshPendingHost?.sessionId) {
      setError(t("ssh.missingSessionId"));
      return;
    }
    const pending = sshPendingHost;
    setSshTrustLoading(true);
    setError(null);
    try {
      const session = await sshTrustHost(
        pending.entryId,
        pending.sessionId,
        pending.fingerprint,
      );
      setSshPendingHost(null);
      setSshTerminal({
        session,
        entryId: pending.entryId,
        entryTitle: pending.entryTitle,
      });
      if (selectedEntry?.id === pending.entryId) {
        const entry = await getEntry(pending.entryId);
        setSelectedEntry(entry);
      }
    } catch (e) {
      setError(formatVaultError(e));
      handleRejectUnknownHost();
    } finally {
      setSshTrustLoading(false);
    }
  }, [handleRejectUnknownHost, selectedEntry?.id, sshPendingHost, t]);

  const handleResetSshFingerprint = useCallback(
    async (entryId: string) => {
      setError(null);
      try {
        await clearSshHostFingerprint(entryId);
        await handleSelectEntry(entryId);
      } catch (e) {
        setError(formatVaultError(e));
      }
    },
    [handleSelectEntry],
  );

  const handleSshSessionActive = useCallback(() => {
    setSshSessionStatus("active");
  }, []);

  const handleSshSessionEnded = useCallback(() => {
    setSshTerminal(null);
    setSshFocusMode(false);
    setSshSessionStatus("disconnected");
  }, []);

  const handleToggleSshFocusMode = useCallback(() => {
    setSshFocusMode((prev) => !prev);
  }, []);

  const handleVaultLockClick = useCallback(() => {
    void handleLock();
  }, [handleLock]);

  const onShortcutLock = useCallback(() => {
    if (vaultInfo && !vaultInfo.locked) {
      void handleLock();
    }
  }, [vaultInfo, handleLock]);

  const onShortcutSearch = useCallback(() => {
    const el = searchRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const onShortcutNewSecret = useCallback(() => {
    if (screen === "vault") {
      setShowAddForm(true);
    }
  }, [screen]);

  const onShortcutGenerator = useCallback(() => {
    if (vaultUnlocked) {
      openPasswordGenerator();
    }
  }, [vaultUnlocked, openPasswordGenerator]);

  const shortcuts = useMemo(
    () => ({
      "mod+l": onShortcutLock,
      "mod+k": onShortcutSearch,
      "mod+n": onShortcutNewSecret,
      "mod+g": onShortcutGenerator,
    }),
    [onShortcutLock, onShortcutSearch, onShortcutNewSecret, onShortcutGenerator],
  );

  useKeyboardShortcuts(shortcuts);

  useEffect(() => {
    if (screen === "unlock" || screen === "create" || screen === "open") {
      passwordRef.current?.focus();
    }
  }, [screen]);

  const filteredEntries = useMemo(
    () => filterEntries(entries, search, activeTag, dashboardFilter),
    [entries, search, activeTag, dashboardFilter],
  );

  const hasSidebarFilter = Boolean(search.trim() || activeTag || dashboardFilter);

  const reachability = useReachabilityPolling(entries, vaultUnlocked);

  const vaultStatus = (
    <AppVaultStatus
      vaultInfo={vaultInfo}
      gitSyncSettings={gitSyncSettings}
      gitSyncing={gitSyncing}
      gitSyncError={gitSyncError}
      onOpenGitSettings={openGitSettings}
      onLock={handleVaultLockClick}
    />
  );

  if (!isTauri()) {
    return (
      <Layout>
        <BrowserPreview />
      </Layout>
    );
  }

  return (
    <Layout
      vaultStatus={vaultStatus}
      onOpenSettings={() => openSettings("general")}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppMainArea
          settingsOpen={settingsOpen}
          settingsCategory={settingsCategory}
          onCloseSettings={() => setSettingsOpen(false)}
          onGitSyncChange={handleGitSyncChange}
          onTriggerGitSync={() => runAsync(handleGitSync)}
          gitSyncing={gitSyncing}
          vaultLocked={vaultLocked}
          onGoToUnlock={handleGoToUnlockFromSettings}
          idleWarningSeconds={idleWarningSeconds}
          vaultUnlocked={vaultUnlocked}
        >
          <AppScreenContent
            screen={screen}
            backendStatus={backendStatus}
            vaultInfo={vaultInfo}
            vaultPath={vaultPath}
            password={password}
            vaultName={vaultName}
            error={error}
            loading={loading}
            passwordRef={passwordRef}
            searchRef={searchRef}
            onPasswordChange={setPassword}
            onVaultNameChange={setVaultName}
            onStartCreate={startCreate}
            onStartOpen={startOpen}
            onCreate={handleCreate}
            onOpen={handleAuthSubmit}
            onUnlock={handleAuthSubmit}
            mfaChallengeActive={mfaChallengeActive}
            mfaCode={mfaCode}
            mfaLockedOut={mfaLockedOut}
            mfaLockoutSeconds={mfaLockoutSeconds}
            onMfaCodeChange={setMfaCode}
            onMfaAutoSubmit={handleMfaAutoSubmit}
            onCancelMfaChallenge={handleCancelMfaChallenge}
            onSwitchVault={handleSwitchVault}
            onBackToWelcome={backToWelcome}
            onBackFromOpen={backFromOpen}
            vaultMainView={vaultMainView}
            onVaultMainViewChange={setVaultMainView}
            search={search}
            onSearchChange={setSearch}
            entries={entries}
            filteredEntries={filteredEntries}
            hasSidebarFilter={hasSidebarFilter}
            activeTag={activeTag}
            onTagChange={handleTagChange}
            dashboardFilter={dashboardFilter}
            onClearDashboardFilter={clearDashboardFilter}
            selectedId={selectedId}
            selectedEntry={selectedEntry}
            onSelectEntry={handleSelectEntry}
            onCopyPassword={handleSidebarCopyPassword}
            onOpenWebsite={handleSidebarOpenWebsite}
            onQuickConnect={handleQuickConnect}
            onResetSshFingerprint={handleResetSshFingerprint}
            sshConnecting={sshConnecting}
            sidebarCopyingId={sidebarCopyingId}
            reachability={reachability}
            onApplyDashboardFilter={handleApplyDashboardFilter}
            onShowAddForm={handleShowAddForm}
            onEditEntry={setEditEntry}
            showAddForm={showAddForm}
            editEntry={editEntry}
            newSecretPrefillPassword={newSecretPrefillPassword}
            onCloseSecretForm={closeSecretForm}
            onAddEntry={handleAddEntry}
            onUpdateEntry={handleUpdateEntry}
            onDeleteEntry={handleDeleteEntry}
            deleteEntryLoading={loading}
            onOpenGenerator={openPasswordGenerator}
            showPasswordGenerator={showPasswordGenerator}
            onClosePasswordGenerator={closePasswordGenerator}
            generatorApply={generatorApply ?? undefined}
            sshTerminal={sshTerminal}
            sshSessionStatus={sshSessionStatus}
            sshFocusMode={sshFocusMode}
            onToggleSshFocusMode={handleToggleSshFocusMode}
            onCloseSshTerminal={handleCloseSshTerminal}
            onSshSessionActive={handleSshSessionActive}
            onSshSessionEnded={handleSshSessionEnded}
          />
        </AppMainArea>
      </div>
      {sshPendingHost ? (
        <SshUnknownHostDialog
          pending={sshPendingHost}
          loading={sshTrustLoading}
          onTrust={() => runAsync(handleTrustUnknownHost)}
          onReject={handleRejectUnknownHost}
        />
      ) : null}
      {sshHostKeyMismatch ? (
        <SshHostKeyMismatchDialog
          mismatch={sshHostKeyMismatch}
          onClose={() => setSshHostKeyMismatch(null)}
        />
      ) : null}
    </Layout>
  );
}
