import { runAsync } from "@/lib/runAsync";
import { AuthForm } from "@/components/screens/AuthForm";
import { WelcomeScreen } from "@/components/screens/WelcomeScreen";
import { VaultWorkspace } from "@/components/VaultWorkspace";
import type { ReachabilityState } from "@/types/reachability";
import type { DashboardFilter } from "@/types/dashboardFilter";
import type {
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretEntrySummary,
  VaultInfo,
} from "@/types/vault";
import type { SshSessionStatus, SshTerminalState } from "@/types/ssh";

type Screen = "welcome" | "create" | "open" | "unlock" | "vault";
type VaultMainView = "secrets" | "security" | "activity";

interface AppScreenContentProps {
  readonly screen: Screen;
  readonly backendStatus: string;
  readonly vaultInfo: VaultInfo | null;
  readonly vaultPath: string | null;
  readonly password: string;
  readonly vaultName: string;
  readonly error: string | null;
  readonly loading: boolean;
  readonly passwordRef: React.RefObject<HTMLInputElement | null>;
  readonly searchRef: React.RefObject<HTMLInputElement | null>;
  readonly onPasswordChange: (value: string) => void;
  readonly onVaultNameChange: (value: string) => void;
  readonly onStartCreate: () => void;
  readonly onStartOpen: () => Promise<void>;
  readonly onCreate: () => void;
  readonly onOpen: () => void;
  readonly onUnlock: () => void;
  readonly mfaChallengeActive: boolean;
  readonly mfaCode: string;
  readonly mfaLockedOut: boolean;
  readonly mfaLockoutSeconds: number;
  readonly onMfaCodeChange: (value: string) => void;
  readonly onMfaAutoSubmit: (code: string) => void;
  readonly onCancelMfaChallenge: () => void;
  readonly onSwitchVault: () => void;
  readonly onBackToWelcome: () => void;
  readonly onBackFromOpen: () => void;
  readonly vaultMainView: VaultMainView;
  readonly onVaultMainViewChange: (view: VaultMainView) => void;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly entries: SecretEntrySummary[];
  readonly filteredEntries: SecretEntrySummary[];
  readonly hasSidebarFilter: boolean;
  readonly activeTag: string | null;
  readonly onTagChange: (tag: string | null) => void;
  readonly dashboardFilter: DashboardFilter | null;
  readonly onClearDashboardFilter: () => void;
  readonly selectedId: string | null;
  readonly selectedEntry: SecretEntryPublic | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onCopyPassword: (id: string) => void;
  readonly onOpenWebsite: (entry: SecretEntrySummary) => void;
  readonly onQuickConnect: (id: string) => void;
  readonly sshConnecting: boolean;
  readonly sidebarCopyingId: string | null;
  readonly reachability: Record<string, ReachabilityState>;
  readonly onApplyDashboardFilter: (filter: DashboardFilter) => void;
  readonly onShowAddForm: () => void;
  readonly onEditEntry: (entry: SecretEntryPublic) => void;
  readonly showAddForm: boolean;
  readonly editEntry: SecretEntryPublic | null;
  readonly newSecretPrefillPassword?: string | null;
  readonly onCloseSecretForm: () => void;
  readonly onAddEntry: (input: SecretEntryInputFull) => void;
  readonly onUpdateEntry: (id: string, input: SecretEntryInputFull) => void;
  readonly onDeleteEntry: (id: string) => void;
  readonly deleteEntryLoading?: boolean;
  readonly onOpenGenerator: (apply?: (pwd: string) => void) => void;
  readonly showPasswordGenerator: boolean;
  readonly onClosePasswordGenerator: () => void;
  readonly generatorApply?: (pwd: string) => void;
  readonly sshTerminal: SshTerminalState | null;
  readonly sshSessionStatus: SshSessionStatus | null;
  readonly sshFocusMode: boolean;
  readonly onToggleSshFocusMode: () => void;
  readonly onCloseSshTerminal: () => void;
  readonly onSshSessionActive: () => void;
  readonly onSshSessionEnded: () => void;
}

export function AppScreenContent(props: Readonly<AppScreenContentProps>) {
  switch (props.screen) {
    case "welcome":
      return (
        <WelcomeScreen
          backendStatus={props.backendStatus}
          onCreate={props.onStartCreate}
          onOpen={() => runAsync(props.onStartOpen)}
        />
      );
    case "create":
      return (
        <AuthForm
          titleKey="auth.createTitle"
          descriptionKey="auth.createDescription"
          password={props.password}
          onPasswordChange={props.onPasswordChange}
          vaultName={props.vaultName}
          onVaultNameChange={props.onVaultNameChange}
          enforceMasterPolicy
          error={props.error}
          loading={props.loading}
          submitLabelKey="auth.createSubmit"
          onSubmit={props.onCreate}
          onBack={props.onBackToWelcome}
          passwordRef={props.passwordRef}
        />
      );
    case "open":
      return (
        <AuthForm
          titleKey="auth.openTitle"
          descriptionKey="auth.openDescription"
          subtitle={props.vaultPath ?? undefined}
          password={props.password}
          onPasswordChange={props.onPasswordChange}
          mfaChallenge={props.mfaChallengeActive}
          mfaCode={props.mfaCode}
          mfaLockedOut={props.mfaLockedOut}
          mfaLockoutSeconds={props.mfaLockoutSeconds}
          onMfaCodeChange={props.onMfaCodeChange}
          onMfaAutoSubmit={props.onMfaAutoSubmit}
          error={props.error}
          loading={props.loading}
          submitLabelKey="auth.openSubmit"
          onSubmit={props.onOpen}
          onBack={props.onBackFromOpen}
          onCancelMfaChallenge={props.onCancelMfaChallenge}
          passwordRef={props.passwordRef}
        />
      );
    case "unlock":
      return (
        <AuthForm
          titleKey="auth.unlockTitle"
          subtitle={props.vaultInfo?.path ?? undefined}
          password={props.password}
          onPasswordChange={props.onPasswordChange}
          mfaChallenge={props.mfaChallengeActive}
          mfaCode={props.mfaCode}
          mfaLockedOut={props.mfaLockedOut}
          mfaLockoutSeconds={props.mfaLockoutSeconds}
          onMfaCodeChange={props.onMfaCodeChange}
          onMfaAutoSubmit={props.onMfaAutoSubmit}
          error={props.error}
          loading={props.loading}
          submitLabelKey="auth.unlockSubmit"
          onSubmit={props.onUnlock}
          onSwitchVault={props.onSwitchVault}
          onCancelMfaChallenge={props.onCancelMfaChallenge}
          passwordRef={props.passwordRef}
        />
      );
    case "vault":
      if (!props.vaultInfo) {
        return null;
      }
      return (
        <VaultWorkspace
          vaultMainView={props.vaultMainView}
          onVaultMainViewChange={props.onVaultMainViewChange}
          search={props.search}
          onSearchChange={props.onSearchChange}
          searchRef={props.searchRef}
          entries={props.entries}
          filteredEntries={props.filteredEntries}
          hasSidebarFilter={props.hasSidebarFilter}
          activeTag={props.activeTag}
          onTagChange={props.onTagChange}
          dashboardFilter={props.dashboardFilter}
          onClearDashboardFilter={props.onClearDashboardFilter}
          selectedId={props.selectedId}
          selectedEntry={props.selectedEntry}
          onSelectEntry={props.onSelectEntry}
          onCopyPassword={props.onCopyPassword}
          onOpenWebsite={props.onOpenWebsite}
          onQuickConnect={props.onQuickConnect}
          sshConnecting={props.sshConnecting}
          sidebarCopyingId={props.sidebarCopyingId}
          reachability={props.reachability}
          onApplyDashboardFilter={props.onApplyDashboardFilter}
          onShowAddForm={props.onShowAddForm}
          onEditEntry={props.onEditEntry}
          error={props.error}
          showAddForm={props.showAddForm}
          editEntry={props.editEntry}
          newSecretPrefillPassword={props.newSecretPrefillPassword}
          loading={props.loading}
          onCloseSecretForm={props.onCloseSecretForm}
          onAddEntry={props.onAddEntry}
          onUpdateEntry={props.onUpdateEntry}
          onDeleteEntry={props.onDeleteEntry}
          deleteEntryLoading={props.deleteEntryLoading}
          onOpenGenerator={props.onOpenGenerator}
          showPasswordGenerator={props.showPasswordGenerator}
          onClosePasswordGenerator={props.onClosePasswordGenerator}
          generatorApply={props.generatorApply}
          sshTerminal={props.sshTerminal}
          sshSessionStatus={props.sshSessionStatus}
          sshFocusMode={props.sshFocusMode}
          onToggleSshFocusMode={props.onToggleSshFocusMode}
          onCloseSshTerminal={props.onCloseSshTerminal}
          onSshSessionActive={props.onSshSessionActive}
          onSshSessionEnded={props.onSshSessionEnded}
        />
      );
    default:
      return null;
  }
}

export { BrowserPreview } from "@/components/screens/BrowserPreview";
