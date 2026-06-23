import { ClipboardToast } from "@/components/ClipboardToast";
import { NewSecretModal } from "@/components/NewSecretModal";
import { PasswordGeneratorModal } from "@/components/PasswordGeneratorModal";
import type { SecretEntryInputFull, SecretEntryPublic } from "@/types/vault";

export interface VaultWorkspaceModalsProps {
  readonly showAddForm: boolean;
  readonly editEntry: SecretEntryPublic | null;
  readonly newSecretPrefillPassword?: string | null;
  readonly loading: boolean;
  readonly onCloseSecretForm: () => void;
  readonly onAddEntry: (input: SecretEntryInputFull) => void;
  readonly onUpdateEntry: (id: string, input: SecretEntryInputFull) => void;
  readonly onOpenGenerator: (apply?: (pwd: string) => void) => void;
  readonly showPasswordGenerator: boolean;
  readonly onClosePasswordGenerator: () => void;
  readonly generatorApply?: (pwd: string) => void;
}

export function VaultWorkspaceModals({
  showAddForm,
  editEntry,
  newSecretPrefillPassword,
  loading,
  onCloseSecretForm,
  onAddEntry,
  onUpdateEntry,
  onOpenGenerator,
  showPasswordGenerator,
  onClosePasswordGenerator,
  generatorApply,
}: Readonly<VaultWorkspaceModalsProps>) {
  return (
    <>
      <NewSecretModal
        open={showAddForm || editEntry !== null}
        mode={editEntry ? "edit" : "create"}
        editEntry={editEntry ?? undefined}
        initialPassword={newSecretPrefillPassword ?? undefined}
        loading={loading}
        onClose={onCloseSecretForm}
        onSubmit={onAddEntry}
        onUpdate={onUpdateEntry}
        onOpenGenerator={onOpenGenerator}
      />
      <PasswordGeneratorModal
        open={showPasswordGenerator}
        onClose={onClosePasswordGenerator}
        onApply={generatorApply}
      />
      <ClipboardToast />
    </>
  );
}
