import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ClipboardToast } from "@/components/ClipboardToast";
import { EntryDetail } from "@/components/EntryDetail";
import { Layout } from "@/components/Layout";
import { NewSecretModal } from "@/components/NewSecretModal";
import { PasswordGeneratorModal } from "@/components/PasswordGeneratorModal";
import { SshTerminalModal } from "@/components/SshTerminalModal";
import { SyncButton } from "@/components/SyncButton";
import { AppLogo } from "@/components/AppLogo";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useReachabilityPolling } from "@/hooks/useReachabilityPolling";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { pickVaultOpenPath, pickVaultSavePath } from "@/lib/dialog";
import { formatVaultError } from "@/lib/errors";
import { cancelSecureClipboardClear } from "@/lib/secureClipboard";
import { filterEntries } from "@/lib/search";
import { SidebarEntryList } from "@/components/SidebarEntryList";
import { SecurityDashboard } from "@/components/SecurityDashboard";
import { ComplianceDashboard } from "@/dashboard";
import { AuditLogTable } from "@/components/AuditLogTable";
import { DashboardFilterBar } from "@/components/DashboardFilterBar";
import { SidebarTagFilter } from "@/components/SidebarTagFilter";
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
import { notifyBackendSecureCopy } from "@/lib/secureClipboard";
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
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [backendStatus, setBackendStatus] = useState<string>("…");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [password, setPassword] = useState("");
  const [vaultName, setVaultName] = useState("Mein Vault");
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
      setBackendStatus("browser-only");
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
      setBackendStatus("offline");
    }
  }, [refreshEntries]);

  useEffect(() => {
    void refresh();
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
      window.setTimeout(() => setGitSyncMessage(null), 4000);
    } catch (e) {
      setGitSyncError(formatVaultError(e));
      window.setTimeout(() => setGitSyncError(null), 5000);
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
      const info = await createVault(path, vaultName.trim() || "Mein Vault", password);
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
  }, [password, vaultName, refreshEntries]);

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
    void listen<{ reason: string; info: VaultInfo }>("vault-locked", (event) => {
      const msg =
        event.payload.reason === "minimize"
          ? "Vault gesperrt — Fenster wurde minimiert."
          : undefined;
      applyLockedUi(event.payload.info, msg);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [applyLockedUi]);

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
      setError("Automatisch gesperrt nach 2 Minuten Inaktivität.");
    } catch (e) {
      setError(String(e));
    }
  }, [performLock]);

  const openPasswordGenerator = useCallback((apply?: (pwd: string) => void) => {
    setGeneratorApply(apply ?? null);
    setShowPasswordGenerator(true);
  }, []);

  const vaultUnlocked = screen === "vault" && !!vaultInfo && !vaultInfo.locked;
  useAutoLock(
    vaultUnlocked,
    () => {
      void handleAutoLock();
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
        entry?.title ?? entries.find((e) => e.id === entryId)?.title ?? "SSH";
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
    [selectedEntry, entries],
  );

  const handleSidebarCopyPassword = useCallback(
    async (entryId: string) => {
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
    },
    [],
  );

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

  const shortcuts = useMemo(
    () => ({
      "mod+l": () => {
        if (vaultInfo && !vaultInfo.locked) void handleLock();
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
        onSync={() => void handleGitSync()}
      />
      <span
        className={`h-2 w-2 rounded-full ${vaultInfo.locked ? "bg-vault-danger" : "bg-vault-success"}`}
      />
      <span className="text-vault-muted">
        {vaultInfo.locked ? "gesperrt" : "entsperrt"} · {vaultInfo.name} · v
        {vaultInfo.version}
      </span>
    </div>
  ) : null;

  if (!isTauri()) {
    return (
      <Layout>
        <section className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-3">
            <h1 className="text-lg font-semibold">Browser-Vorschau</h1>
            <p className="text-sm text-vault-muted">
              Das Rust-Backend ist nur über Tauri verfügbar. Starte die App mit{" "}
              <code className="rounded bg-vault-surface px-1 font-mono text-xs">
                npm run tauri:dev
              </code>
              .
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout status={statusBadge} onGitSyncChange={handleGitSyncChange}>
      {screen === "welcome" && (
        <WelcomeScreen
          onCreate={() => {
            setError(null);
            setPassword("");
            setVaultPath(null);
            setScreen("create");
          }}
          onOpen={async () => {
            setError(null);
            setPassword("");
            const path = await pickVaultOpenPath();
            if (path) {
              setVaultPath(path);
              setScreen("open");
            }
          }}
          backendStatus={backendStatus}
        />
      )}

      {screen === "create" && (
        <AuthForm
          title="Neuen Vault anlegen"
          description="Master-Passwort festlegen. Anschließend wählst du den Speicherort für die .oxid-Datei."
          password={password}
          onPasswordChange={setPassword}
          vaultName={vaultName}
          onVaultNameChange={setVaultName}
          enforceMasterPolicy
          error={error}
          loading={loading}
          submitLabel="Weiter — Speicherort wählen"
          onSubmit={() => void handleCreate()}
          onBack={() => {
            setScreen("welcome");
            setPassword("");
            setError(null);
          }}
          passwordRef={passwordRef}
        />
      )}

      {screen === "open" && (
        <AuthForm
          title="Vault öffnen"
          description="Master-Passwort eingeben, um den Vault zu entschlüsseln."
          subtitle={vaultPath ?? undefined}
          password={password}
          onPasswordChange={setPassword}
          error={error}
          loading={loading}
          submitLabel="Vault öffnen"
          onSubmit={() => void handleOpen()}
          onBack={() => {
            setScreen("welcome");
            setPassword("");
            setVaultPath(null);
            setError(null);
          }}
          passwordRef={passwordRef}
        />
      )}

      {screen === "unlock" && (
        <AuthForm
          title="Vault entsperren"
          subtitle={vaultInfo?.path ?? undefined}
          password={password}
          onPasswordChange={setPassword}
          error={error}
          loading={loading}
          submitLabel="Entsperren"
          onSubmit={() => void handleUnlock()}
          onSwitchVault={() => void handleSwitchVault()}
          passwordRef={passwordRef}
        />
      )}

      {screen === "vault" && vaultInfo && (
        <div className="flex flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r border-vault-border bg-vault-surface">
            <div className="flex gap-1 border-b border-vault-border p-2">
              <SidebarNavTab
                label="Secrets"
                active={vaultMainView === "secrets"}
                onClick={() => setVaultMainView("secrets")}
              />
              <SidebarNavTab
                label="Security"
                active={vaultMainView === "security"}
                onClick={() => setVaultMainView("security")}
              />
              <SidebarNavTab
                label="Aktivität"
                active={vaultMainView === "activity"}
                onClick={() => setVaultMainView("activity")}
              />
            </div>
            <div className="border-b border-vault-border p-3">
              <input
                ref={searchRef}
                id="search-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Titel, URL, Benutzer…"
                className="w-full rounded border border-vault-border bg-vault-bg px-2 py-1.5 font-mono text-xs placeholder:text-vault-muted focus:border-vault-accent outline-none"
              />
            </div>
            <SidebarTagFilter
              entries={entries}
              activeTag={activeTag}
              onTagChange={handleTagChange}
            />
            {dashboardFilter && (
              <DashboardFilterBar
                kind={dashboardFilter.kind}
                label={dashboardFilter.label}
                onClear={clearDashboardFilter}
              />
            )}
            <nav className="flex-1 overflow-y-auto p-2">
              <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-wider text-vault-muted">
                Einträge ·{" "}
                {hasSidebarFilter
                  ? `${filteredEntries.length}/${entries.length}`
                  : entries.length}
              </p>
              {filteredEntries.length === 0 ? (
                <p className="px-2 py-4 text-center font-mono text-xs text-vault-muted">
                  {hasSidebarFilter ? "Keine Treffer" : "Keine Einträge"}
                </p>
              ) : (
                <SidebarEntryList
                  entries={filteredEntries}
                  selectedId={selectedId}
                  onSelect={(id) => void handleSelectEntry(id)}
                  onCopyPassword={(id) => void handleSidebarCopyPassword(id)}
                  onOpenWebsite={(e) => void handleSidebarOpenWebsite(e)}
                  onQuickConnect={(id) => void handleQuickConnect(id)}
                  sshConnecting={sshConnecting}
                  copyingId={sidebarCopyingId}
                  reachability={reachability}
                />
              )}
            </nav>
            <div className="border-t border-vault-border p-2">
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="w-full rounded bg-vault-accent py-1.5 font-mono text-xs text-white hover:bg-vault-accent-hover"
              >
                + Neues Secret
              </button>
            </div>
          </aside>

          <section className="relative flex flex-1 flex-col overflow-hidden">
            {vaultMainView === "security" ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                <ComplianceDashboard />
                <SecurityDashboard
                  onSelectEntry={(id) => void handleSelectEntry(id)}
                  onApplyFilter={handleApplyDashboardFilter}
                  activeFilterKind={dashboardFilter?.kind ?? null}
                />
              </div>
            ) : vaultMainView === "activity" ? (
              <AuditLogTable />
            ) : selectedEntry ? (
              <EntryDetail
                entry={selectedEntry}
                onLock={() => void handleLock()}
                onEdit={() => setEditEntry(selectedEntry)}
                onQuickConnect={(id) => void handleQuickConnect(id)}
                sshConnecting={sshConnecting}
                reachability={reachability[selectedEntry.id]}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm text-vault-muted">
                  {entries.length === 0
                    ? "Noch keine Secrets — Ctrl+N zum Anlegen."
                    : "Eintrag auswählen oder neues Secret anlegen."}
                </p>
                <button
                  type="button"
                  onClick={() => void handleLock()}
                  className="mt-2 rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:border-vault-danger hover:text-vault-danger"
                >
                  Vault sperren
                </button>
              </div>
            )}
            {error && (
              <p className="border-t border-vault-border px-4 py-2 font-mono text-xs text-vault-danger">
                {error}
              </p>
            )}
          </section>

          <NewSecretModal
            open={showAddForm || editEntry !== null}
            mode={editEntry ? "edit" : "create"}
            editEntry={editEntry ?? undefined}
            loading={loading}
            onClose={closeSecretForm}
            onSubmit={(input) => void handleAddEntry(input)}
            onUpdate={(id, input) => void handleUpdateEntry(id, input)}
            onOpenGenerator={(apply) => openPasswordGenerator(apply)}
          />
          <PasswordGeneratorModal
            open={showPasswordGenerator}
            onClose={() => {
              setShowPasswordGenerator(false);
              setGeneratorApply(null);
            }}
            onApply={generatorApply ?? undefined}
          />
          <ClipboardToast />
          {sshTerminal && (
            <SshTerminalModal
              state={sshTerminal}
              onClose={() => setSshTerminal(null)}
            />
          )}
        </div>
      )}
    </Layout>
  );
}

function WelcomeScreen({
  onCreate,
  onOpen,
  backendStatus,
}: {
  onCreate: () => void;
  onOpen: () => void;
  backendStatus: string;
}) {
  return (
    <section className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex flex-col items-center space-y-3">
          <AppLogo size="lg" />
          <div className="space-y-2">
          <h1 className="text-xl font-semibold">OxidVault</h1>
          <p className="text-sm text-vault-muted">
            Offline-First Secret Manager · Backend:{" "}
            <span className="font-mono text-vault-text">{backendStatus}</span>
          </p>
        </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void onCreate()}
            className="rounded bg-vault-accent py-2.5 text-sm font-medium text-white hover:bg-vault-accent-hover"
          >
            Neuen Vault anlegen
          </button>
          <button
            type="button"
            onClick={() => void onOpen()}
            className="rounded border border-vault-border py-2.5 text-sm text-vault-muted hover:border-vault-accent hover:text-vault-text"
          >
            Bestehenden Vault öffnen
          </button>
        </div>
        <p className="font-mono text-[11px] text-vault-muted">
          Argon2id · AES-256-GCM · .oxid
        </p>
      </div>
    </section>
  );
}

function AuthForm({
  title,
  description,
  subtitle,
  password,
  onPasswordChange,
  vaultName,
  onVaultNameChange,
  enforceMasterPolicy,
  error,
  loading,
  submitLabel,
  onSubmit,
  onBack,
  onSwitchVault,
  passwordRef,
}: {
  title: string;
  description?: string;
  subtitle?: string;
  password: string;
  onPasswordChange: (v: string) => void;
  vaultName?: string;
  onVaultNameChange?: (v: string) => void;
  enforceMasterPolicy?: boolean;
  error: string | null;
  loading: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onBack?: () => void;
  onSwitchVault?: () => void;
  passwordRef: React.RefObject<HTMLInputElement | null>;
}) {
  const policyValid = enforceMasterPolicy
    ? evaluateMasterPassword(password).valid
    : password.length > 0;
  const canSubmit = !loading && policyValid;

  return (
    <section className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center space-y-3 text-center">
          <AppLogo size="md" />
          <div className="space-y-1">
          <h1 className="text-lg font-semibold">{title}</h1>
          {description && (
            <p className="text-sm text-vault-muted">{description}</p>
          )}
          {subtitle && (
            <p className="truncate font-mono text-[11px] text-vault-muted">{subtitle}</p>
          )}
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {vaultName !== undefined && onVaultNameChange && (
            <input
              type="text"
              value={vaultName}
              onChange={(e) => onVaultNameChange(e.target.value)}
              placeholder="Vault-Name"
              className="w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent"
            />
          )}
          {enforceMasterPolicy ? (
            <MasterPasswordInput
              value={password}
              onChange={onPasswordChange}
              inputRef={passwordRef}
            />
          ) : (
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Master-Passwort"
              autoComplete="current-password"
              className="w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent"
            />
          )}
          {error && <p className="font-mono text-xs text-vault-danger">{error}</p>}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded bg-vault-accent py-2 text-sm font-medium text-white hover:bg-vault-accent-hover disabled:opacity-50"
          >
            {loading ? "Bitte warten…" : submitLabel}
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="w-full py-1 text-xs text-vault-muted hover:text-vault-text"
            >
              Zurück
            </button>
          )}
          {onSwitchVault && (
            <button
              type="button"
              onClick={onSwitchVault}
              disabled={loading}
              className="w-full py-1 text-xs text-vault-muted/80 hover:text-vault-muted disabled:opacity-50"
            >
              Anderen Tresor öffnen
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

function SidebarNavTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-2 py-1.5 font-mono text-[11px] transition ${
        active
          ? "bg-vault-accent/20 text-vault-text"
          : "text-vault-muted hover:bg-vault-border/50 hover:text-vault-text"
      }`}
    >
      {label}
    </button>
  );
}
