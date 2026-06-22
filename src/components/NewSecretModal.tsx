import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { PasswordGenerateButton } from "@/components/PasswordGenerateButton";
import { TagInput } from "@/components/TagInput";
import { OverlayModal } from "@/components/ui/OverlayModal";
import {
  DB_TYPE_VALUES,
  getDbTypeLabel,
  getSecretTypeDescription,
  getSecretTypeLabel,
  getWifiEncryptionLabel,
  SECRET_KINDS,
  WIFI_ENCRYPTION_VALUES,
} from "@/lib/vaultLabels";
import { runAsync } from "@/lib/runAsync";
import { secretFormSubmitLabel } from "@/lib/secretFormLabels";
import { INPUT_FIELD_CLASS, MODAL_FOOTER_CLASS } from "@/lib/uiClasses";
import type {
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretKind,
  SecretPayload,
} from "@/types/vault";
import { loadEditFormState } from "@/lib/secretFormLoaders";

interface NewSecretModalProps {
  readonly open: boolean;
  readonly loading: boolean;
  readonly mode?: "create" | "edit";
  readonly editEntry?: SecretEntryPublic;
  readonly initialPassword?: string;
  readonly onClose: () => void;
  readonly onSubmit: (input: SecretEntryInputFull) => void;
  readonly onUpdate?: (id: string, input: SecretEntryInputFull) => void;
  readonly onOpenGenerator?: (apply: (password: string) => void) => void;
}

const emptyWeb = { url: "", username: "", password: "", notes: "" };
const emptySsh = { host: "", username: "", privateKey: "", passphrase: "" };
const emptyApi = { service: "", token: "" };
const emptyDb = {
  host: "",
  port: "5432",
  dbType: "postgresql",
  databaseName: "",
  username: "",
  password: "",
};
const emptyWifi = { ssid: "", encryptionType: "wpa2", password: "" };
const emptyNote = { content: "" };

export function NewSecretModal({
  open,
  loading,
  mode = "create",
  editEntry,
  initialPassword,
  onClose,
  onSubmit,
  onUpdate,
  onOpenGenerator,
}: Readonly<NewSecretModalProps>) {
  const { t } = useTranslation();
  const isEdit = mode === "edit" && !!editEntry;
  const [kind, setKind] = useState<SecretKind>("web_login");
  const [title, setTitle] = useState("");
  const [web, setWeb] = useState(emptyWeb);
  const [ssh, setSsh] = useState(emptySsh);
  const [api, setApi] = useState(emptyApi);
  const [db, setDb] = useState(emptyDb);
  const [wifi, setWifi] = useState(emptyWifi);
  const [note, setNote] = useState(emptyNote);
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && editEntry) {
      let cancelled = false;
      setLoadingSecrets(true);
      runAsync(async () => {
        try {
          const state = await loadEditFormState(editEntry);
          if (cancelled) return;
          setKind(state.kind);
          setTitle(state.title);
          setFolder(state.folder);
          setTags(state.tags);
          setExpiresAt(state.expiresAt);
          setWeb(state.web);
          setSsh(state.ssh);
          setApi(state.api);
          setDb(state.db);
          setWifi(state.wifi);
          setNote(state.note);
        } finally {
          if (!cancelled) setLoadingSecrets(false);
        }
      });
      return () => {
        cancelled = true;
      };
    } else {
      setKind("web_login");
      setTitle("");
      setFolder("");
      setTags([]);
      setExpiresAt("");
      setWeb(initialPassword ? { ...emptyWeb, password: initialPassword } : emptyWeb);
      setSsh(emptySsh);
      setApi(emptyApi);
      setDb(emptyDb);
      setWifi(emptyWifi);
      setNote(emptyNote);
    }
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, isEdit, editEntry, initialPassword]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading && !loadingSecrets) {
        onClose();
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open, onClose, loading, loadingSecrets]);

  if (!open) {
    return null;
  }

  const canSubmit = (() => {
    if (!title.trim()) return false;
    switch (kind) {
      case "web_login":
        return !!(web.url.trim() && web.username.trim() && web.password);
      case "ssh_key":
        return !!(ssh.host.trim() && ssh.username.trim() && ssh.privateKey.trim());
      case "api_token":
        return !!(api.service.trim() && api.token.trim());
      case "database": {
        const port = Number.parseInt(db.port, 10);
        return !!(
          db.host.trim() &&
          port > 0 &&
          port <= 65535 &&
          db.dbType.trim() &&
          db.databaseName.trim() &&
          db.username.trim() &&
          db.password
        );
      }
      case "network_wifi":
        return !!(wifi.ssid.trim() && wifi.encryptionType.trim() && wifi.password);
      case "secure_note":
        return !!note.content.trim();
    }
  })();

  const buildPayload = (): SecretPayload => {
    switch (kind) {
      case "web_login":
        return {
          type: "web_login",
          url: web.url.trim(),
          username: web.username.trim(),
          password: web.password,
          notes: web.notes.trim() || undefined,
        };
      case "ssh_key":
        return {
          type: "ssh_key",
          host: ssh.host.trim(),
          username: ssh.username.trim(),
          private_key: ssh.privateKey,
          passphrase: ssh.passphrase.trim() || undefined,
        };
      case "api_token":
        return {
          type: "api_token",
          service: api.service.trim(),
          token: api.token,
        };
      case "database":
        return {
          type: "database",
          host: db.host.trim(),
          port: Number.parseInt(db.port, 10),
          db_type: db.dbType,
          database_name: db.databaseName.trim(),
          username: db.username.trim(),
          password: db.password,
        };
      case "network_wifi":
        return {
          type: "network_wifi",
          ssid: wifi.ssid.trim(),
          encryption_type: wifi.encryptionType,
          password: wifi.password,
        };
      case "secure_note":
        return {
          type: "secure_note",
          content: note.content,
        };
    }
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const input: SecretEntryInputFull = {
      title: title.trim(),
      folder: folder.trim() || undefined,
      tags,
      expires_at: expiresAt.trim() || undefined,
      ...buildPayload(),
    };
    if (isEdit && editEntry && onUpdate) {
      onUpdate(editEntry.id, input);
    } else {
      onSubmit(input);
    }
  };

  const inputClass = INPUT_FIELD_CLASS;

  const openGenerator = (apply: (pwd: string) => void) => {
    onOpenGenerator?.(apply);
  };

  const submitLabel = secretFormSubmitLabel(loadingSecrets, loading, isEdit, t);

  return (
    <OverlayModal
      open={open}
      onClose={onClose}
      ariaLabel={isEdit ? t("secretForm.editTitle") : t("secretForm.createTitle")}
      ariaLabelledBy="secret-form-title"
      closeDisabled={loading || loadingSecrets}
      closeLabel={t("common.closeDialog")}
      panelClassName="max-w-lg"
    >
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id="secret-form-title" className="font-mono text-sm font-semibold">
            {isEdit ? t("secretForm.editTitle") : t("secretForm.createTitle")}
          </h2>
          <p className="mt-1 text-xs text-vault-muted">
            {isEdit
              ? t("secretForm.editSubtitle", { type: getSecretTypeLabel(kind) })
              : t("secretForm.createSubtitle")}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!isEdit && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SECRET_KINDS.map((kindOption) => (
                <button
                  key={kindOption}
                  type="button"
                  onClick={() => setKind(kindOption)}
                  className={`rounded border px-2 py-2 text-left transition ${
                    kind === kindOption
                      ? "border-vault-accent bg-vault-accent/15 text-vault-text"
                      : "border-vault-border text-vault-muted hover:border-vault-accent/50"
                  }`}
                >
                  <span className="block font-mono text-[11px] font-medium">
                    {getSecretTypeLabel(kindOption)}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    {getSecretTypeDescription(kindOption)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <form
            id="secret-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <Field label={t("secretForm.title")} required>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
                placeholder={t("secretForm.titlePlaceholder")}
                required
              />
            </Field>

            <Field label={t("secretForm.folder")}>
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                className={inputClass}
                placeholder={t("secretForm.folderPlaceholder")}
              />
            </Field>

            <Field label={t("secretForm.tags")}>
              <TagInput tags={tags} onChange={setTags} disabled={loading} />
            </Field>

            <Field label={t("secretForm.expiresAt")}>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={inputClass}
              />
            </Field>

            {kind === "web_login" && (
              <>
                <Field label={t("entry.url")} required>
                  <input
                    value={web.url}
                    onChange={(e) => setWeb({ ...web, url: e.target.value })}
                    className={inputClass}
                    placeholder={t("secretForm.urlPlaceholder")}
                    required
                  />
                </Field>
                <Field label={t("entry.username")} required>
                  <input
                    value={web.username}
                    onChange={(e) => setWeb({ ...web, username: e.target.value })}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label={t("entry.password")} required>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={web.password}
                      onChange={(e) => setWeb({ ...web, password: e.target.value })}
                      className={`${inputClass} flex-1`}
                      required
                    />
                    {onOpenGenerator && (
                      <PasswordGenerateButton
                        onClick={() =>
                          openGenerator((pwd) => setWeb((w) => ({ ...w, password: pwd })))
                        }
                      />
                    )}
                  </div>
                </Field>
                <Field label={t("entry.notes")}>
                  <textarea
                    value={web.notes}
                    onChange={(e) => setWeb({ ...web, notes: e.target.value })}
                    rows={2}
                    className={inputClass}
                  />
                </Field>
              </>
            )}

            {kind === "ssh_key" && (
              <>
                <Field label={t("entry.serverIp")} required>
                  <input
                    value={ssh.host}
                    onChange={(e) => setSsh({ ...ssh, host: e.target.value })}
                    className={inputClass}
                    placeholder={t("secretForm.serverPlaceholder")}
                    required
                  />
                </Field>
                <Field label={t("entry.username")} required>
                  <input
                    value={ssh.username}
                    onChange={(e) => setSsh({ ...ssh, username: e.target.value })}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label={t("entry.privateKey")} required>
                  <textarea
                    value={ssh.privateKey}
                    onChange={(e) => setSsh({ ...ssh, privateKey: e.target.value })}
                    rows={5}
                    className={`${inputClass} text-xs`}
                    placeholder={t("secretForm.privateKeyPlaceholder")}
                    required
                  />
                </Field>
                <Field label={t("entry.passphrase")}>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={ssh.passphrase}
                      onChange={(e) => setSsh({ ...ssh, passphrase: e.target.value })}
                      className={`${inputClass} flex-1`}
                    />
                    {onOpenGenerator && (
                      <PasswordGenerateButton
                        onClick={() =>
                          openGenerator((pwd) => setSsh((s) => ({ ...s, passphrase: pwd })))
                        }
                      />
                    )}
                  </div>
                </Field>
              </>
            )}

            {kind === "api_token" && (
              <>
                <Field label={t("secretForm.serviceName")} required>
                  <input
                    value={api.service}
                    onChange={(e) => setApi({ ...api, service: e.target.value })}
                    className={inputClass}
                    placeholder={t("secretForm.servicePlaceholder")}
                    required
                  />
                </Field>
                <Field label={t("entry.apiToken")} required>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={api.token}
                      onChange={(e) => setApi({ ...api, token: e.target.value })}
                      className={`${inputClass} flex-1`}
                      required
                    />
                    {onOpenGenerator && (
                      <PasswordGenerateButton
                        onClick={() =>
                          openGenerator((pwd) => setApi((a) => ({ ...a, token: pwd })))
                        }
                      />
                    )}
                  </div>
                </Field>
              </>
            )}

            {kind === "database" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Field label={t("entry.hostIp")} required>
                    <input
                      value={db.host}
                      onChange={(e) => setDb({ ...db, host: e.target.value })}
                      className={inputClass}
                      placeholder={t("secretForm.hostPlaceholder")}
                      required
                    />
                  </Field>
                  <Field label={t("entry.port")} required>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={db.port}
                      onChange={(e) => setDb({ ...db, port: e.target.value })}
                      className={inputClass}
                      required
                    />
                  </Field>
                  <Field label={t("entry.dbType")} required>
                    <select
                      value={db.dbType}
                      onChange={(e) => setDb({ ...db, dbType: e.target.value })}
                      className={inputClass}
                      required
                    >
                      {DB_TYPE_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {getDbTypeLabel(value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label={t("secretForm.databaseName")} required>
                  <input
                    value={db.databaseName}
                    onChange={(e) => setDb({ ...db, databaseName: e.target.value })}
                    className={inputClass}
                    placeholder={t("secretForm.databaseNamePlaceholder")}
                    required
                  />
                </Field>
                <Field label={t("entry.username")} required>
                  <input
                    value={db.username}
                    onChange={(e) => setDb({ ...db, username: e.target.value })}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label={t("entry.password")} required>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={db.password}
                      onChange={(e) => setDb({ ...db, password: e.target.value })}
                      className={`${inputClass} flex-1`}
                      required
                    />
                    {onOpenGenerator && (
                      <PasswordGenerateButton
                        onClick={() =>
                          openGenerator((pwd) => setDb((d) => ({ ...d, password: pwd })))
                        }
                      />
                    )}
                  </div>
                </Field>
              </>
            )}

            {kind === "network_wifi" && (
              <>
                <Field label={t("entry.ssid")} required>
                  <input
                    value={wifi.ssid}
                    onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })}
                    className={inputClass}
                    placeholder={t("secretForm.ssidPlaceholder")}
                    required
                  />
                </Field>
                <Field label={t("entry.encryption")} required>
                  <select
                    value={wifi.encryptionType}
                    onChange={(e) => setWifi({ ...wifi, encryptionType: e.target.value })}
                    className={inputClass}
                    required
                  >
                    {WIFI_ENCRYPTION_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {getWifiEncryptionLabel(value)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("entry.passwordKey")} required>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={wifi.password}
                      onChange={(e) => setWifi({ ...wifi, password: e.target.value })}
                      className={`${inputClass} flex-1`}
                      required
                    />
                    {onOpenGenerator && (
                      <PasswordGenerateButton
                        onClick={() =>
                          openGenerator((pwd) => setWifi((w) => ({ ...w, password: pwd })))
                        }
                      />
                    )}
                  </div>
                </Field>
              </>
            )}

            {kind === "secure_note" && (
              <Field label={t("entry.content")} required>
                <textarea
                  value={note.content}
                  onChange={(e) => setNote({ content: e.target.value })}
                  rows={12}
                  className={`${inputClass} min-h-[200px] resize-y text-xs leading-relaxed`}
                  placeholder={t("secretForm.notePlaceholder")}
                  required
                />
              </Field>
            )}
          </form>
        </div>

        <footer className={MODAL_FOOTER_CLASS}>
          <button
            type="submit"
            form="secret-form"
            disabled={loading || loadingSecrets || !canSubmit}
            className="flex-1 rounded bg-vault-accent py-2 font-mono text-xs text-vault-on-accent hover:bg-vault-accent-hover disabled:opacity-50"
          >
            {submitLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-vault-border px-4 py-2 font-mono text-xs text-vault-muted hover:text-vault-text"
          >
            {t("common.cancel")}
          </button>
        </footer>
    </OverlayModal>
  );
}

function Field({
  label,
  required,
  children,
}: Readonly<{
  label: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  const { t } = useTranslation();
  const fieldId = useId();
  const isDirectControl =
    isValidElement(children) &&
    typeof children.type === "string" &&
    (children.type === "input" ||
      children.type === "textarea" ||
      children.type === "select");
  const child = isDirectControl
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: fieldId })
    : children;

  return (
    <div className="block space-y-1">
      {isDirectControl ? (
        <label htmlFor={fieldId} className="font-mono text-[11px] text-vault-muted">
          {label}
          {required ? t("common.requiredMark") : null}
        </label>
      ) : (
        <span className="font-mono text-[11px] text-vault-muted">
          {label}
          {required ? t("common.requiredMark") : null}
        </span>
      )}
      {child}
    </div>
  );
}
