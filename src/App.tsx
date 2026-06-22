import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { AppScreenContent, BrowserPreview } from "@/components/AppScreenContent";
import { Layout } from "@/components/Layout";
import { SyncButton } from "@/components/SyncButton";
import { VaultLockButton } from "@/components/ui/VaultLockButton";
import { evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useReachabilityPolling } from "@/hooks/useReachabilityPolling";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { pickVaultOpenPath, pickVaultSavePath } from "@/lib/dialog";
import { formatVaultError } from "@/lib/errors";
import { runAsync } from "@/lib/runAsync";
import { cancelSecureClipboardClear, notifyBackendSecureCopy } from "@/lib/secureClipboard";
import { filterEntries } from "@/lib/search";
import { openWebsiteUrl } from "@/lib/openWebsite";
import { sshConnect } from "@/lib/ssh";
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
  syncVaultGit,
  unlockVault,
  updateEntry,
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
import type { SshTerminalState } from "@/types/ssh";

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
  const [editEntry, setEditEntry] = useState<SecretEntryPublic | null>(null);
  const [showPasswordGenerator, setShowPasswordGenerator] = useState(false);
  const [generatorApply, setGeneratorApply] = useState<((pwd: string) => void) | null>(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter | null>(null);
  const [vaultMainView, setVaultMainView] = useState<VaultMainView>("secrets");
  const [sshTerminal, setSshTerminal] = useState<SshTerminalState | null>(null);
  const [sshConnecting, setSshConnecting] = useState(false);
  const [sidebarCopyingId, setSidebarCopyingId] = useState<string | null>(null);
  const [gitSyncSettings, setGitSyncSettings] = useState<GitSyncSettings>({ enabled: false });
  const [resolvedConfig, setResolvedConfig] = useState<ResolvedConfig | null>(null);
  const [gitSyncing, setGitSyncing] = useState(false);
  const [gitSyncMessage, setGitSyncMessage] = useState<string | null>(null);
  const [gitSyncError, setGitSyncError] = useState<string | null>(null);
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
    setGitSyncMessage(null);
    try {
      const result = await syncVaultGit();
      setGitSyncMessage(result.message);
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
      globalThis.setTimeout(() => setGitSyncMessage(null), 4000);
    } catch (e) {
      setGitSyncError(formatVaultError(e));
      globalThis.setTimeout(() => setGitSyncError(null), 5000);
    } finally {
      setGitSyncing(false);
    }
  }, [refreshEntries, selectedId]);

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

  const handleOpen = useCallback(async () => {
    if (!password.trim() || !vaultPath) return;
    setLoading(true);
    setError(null);
    try {
      const info = await openVault(vaultPath, password);
      setVaultInfo(info);
      setPassword("");
      setScreen("vault");
      await refreshEntries();
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [password, vaultPath, refreshEntries]);

  const handleSwitchVault = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await detachVault();
      setVaultInfo(null);
      setVaultPath(null);
      setPassword("");
      setScreen("welcome");
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUnlock = useCallback(async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const info = await unlockVault(password);
      setVaultInfo(info);
      setPassword("");
      setScreen("vault");
      await refreshEntries();
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [password, refreshEntries]);

  const applyLockedUi = useCallback((info: VaultInfo, message?: string) => {
    cancelSecureClipboardClear();
    setVaultInfo(info);
    setEntries([]);
    setSelectedId(null);
    setSelectedEntry(null);
    setPassword("");
    setShowAddForm(false);
    setEditEntry(null);
    setShowPasswordGenerator(false);
    setGeneratorApply(null);
    setSshTerminal(null);
    setSshConnecting(false);
    setDashboardFilter(null);
    setActiveTag(null);
    setScreen("unlock");
    if (message) setError(message);
  }, []);

  const performLock = useCallback(async () => {
    cancelSecureClipboardClear();
    const info = await lockVault();
    applyLockedUi(info);
  }, [applyLockedUi]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    runAsync(async () => {
      const fn = await listen<{ reason: string; info: VaultInfo }>("vault-locked", (event) => {
        const msg =
          event.payload.reason === "minimize"
            ? t("app.lockedOnMinimize")
            : undefined;
        applyLockedUi(event.payload.info, msg);
      });
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [applyLockedUi, t]);

  const handleLock = useCallback(async () => {
    try {
      setError(null);
      await performLock();
    } catch (e) {
      setError(String(e));
    }
  }, [performLock]);

  const handleAutoLock = useCallback(async () => {
    try {
      await performLock();
      setError(t("app.autoLocked"));
    } catch (e) {
      setError(String(e));
    }
  }, [performLock, t]);

  const openPasswordGenerator = useCallback((apply?: (pwd: string) => void) => {
    setGeneratorApply(apply ?? null);
    setShowPasswordGenerator(true);
  }, []);

  const vaultUnlocked = screen === "vault" && !!vaultInfo && !vaultInfo.locked;
  useAutoLock(
    vaultUnlocked,
    () => {
      runAsync(handleAutoLock);
    },
    resolvedConfig?.autoLockSeconds.value ?? 120,
  );

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
      setError(null);
      try {
        const session = await sshConnect(entryId);
        setSshTerminal({ session, entryTitle: title });
      } catch (e) {
        setError(formatVaultError(e));
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
    setScreen("welcome");
    setPassword("");
    setVaultPath(null);
    setError(null);
  }, []);

  const closePasswordGenerator = useCallback(() => {
    setShowPasswordGenerator(false);
    setGeneratorApply(null);
  }, []);

  const shortcuts = useMemo(
    () => ({
      "mod+l": () => {
        if (vaultInfo && !vaultInfo.locked) {
          runAsync(handleLock);
        }
      },
      "mod+k": () => {
        const el = searchRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      },
      "mod+n": () => {
        if (screen === "vault") setShowAddForm(true);
      },
      "mod+g": () => {
        if (vaultUnlocked) openPasswordGenerator();
      },
    }),
    [vaultInfo, handleLock, screen, vaultUnlocked, openPasswordGenerator],
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

  const statusBadge = vaultInfo ? (
    <div className="flex items-center gap-2 font-mono text-xs">
      <SyncButton
        visible={vaultInfo.initialized && gitSyncSettings.enabled}
        syncing={gitSyncing}
        syncMessage={gitSyncMessage}
        syncError={gitSyncError}
        onSync={handleGitSync}
      />
      <span
        className={`h-2 w-2 rounded-full ${vaultInfo.locked ? "bg-vault-danger" : "bg-vault-success"}`}
      />
      <span className="text-vault-muted">
        {vaultInfo.locked ? t("app.statusLocked") : t("app.statusUnlocked")} · {vaultInfo.name} · v
        {vaultInfo.version}
      </span>
      <VaultLockButton
        locked={vaultInfo.locked}
        onLock={() => runAsync(handleLock)}
      />
    </div>
  ) : null;

  if (!isTauri()) {
    return (
      <Layout>
        <BrowserPreview />
      </Layout>
    );
  }

  return (
    <Layout status={statusBadge} onGitSyncChange={handleGitSyncChange}>
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
        onOpen={handleOpen}
        onUnlock={handleUnlock}
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
        sshConnecting={sshConnecting}
        sidebarCopyingId={sidebarCopyingId}
        reachability={reachability}
        onApplyDashboardFilter={handleApplyDashboardFilter}
        onShowAddForm={() => setShowAddForm(true)}
        onEditEntry={setEditEntry}
        showAddForm={showAddForm}
        editEntry={editEntry}
        onCloseSecretForm={closeSecretForm}
        onAddEntry={handleAddEntry}
        onUpdateEntry={handleUpdateEntry}
        onOpenGenerator={openPasswordGenerator}
        showPasswordGenerator={showPasswordGenerator}
        onClosePasswordGenerator={closePasswordGenerator}
        generatorApply={generatorApply ?? undefined}
        sshTerminal={sshTerminal}
        onCloseSshTerminal={() => setSshTerminal(null)}
      />
    </Layout>
  );
}
