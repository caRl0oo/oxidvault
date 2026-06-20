import { useEffect, useRef, useState } from "react";
import { PasswordGenerateButton } from "@/components/PasswordGenerateButton";
import { TagInput } from "@/components/TagInput";
import type {
  SecretEntryFull,
  SecretEntryInputFull,
  SecretKind,
  SecretPayload,
} from "@/types/vault";
import {
  DB_TYPE_OPTIONS,
  SECRET_TYPE_LABELS,
  WIFI_ENCRYPTION_OPTIONS,
} from "@/types/vault";

interface NewSecretModalProps {
  open: boolean;
  loading: boolean;
  mode?: "create" | "edit";
  editEntry?: SecretEntryFull;
  onClose: () => void;
  onSubmit: (input: SecretEntryInputFull) => void;
  onUpdate?: (id: string, input: SecretEntryInputFull) => void;
  onOpenGenerator?: (apply: (password: string) => void) => void;
}

const TYPE_OPTIONS: { kind: SecretKind; description: string }[] = [
  { kind: "web_login", description: "URL, Benutzer, Passwort" },
  { kind: "ssh_key", description: "Server, Key, Passphrase" },
  { kind: "api_token", description: "Service, API-Key" },
  { kind: "database", description: "Host, Port, DB-Zugang" },
  { kind: "network_wifi", description: "SSID, Verschlüsselung" },
  { kind: "secure_note", description: "Config, Notizen" },
];

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

function entryToFormState(entry: SecretEntryFull) {
  const base = {
    title: entry.title,
    folder: entry.folder ?? "",
    tags: entry.tags ?? [],
    expiresAt: entry.expires_at ?? "",
    web: emptyWeb,
    ssh: emptySsh,
    api: emptyApi,
    db: emptyDb,
    wifi: emptyWifi,
    note: emptyNote,
  };

  switch (entry.type) {
    case "web_login":
      return {
        ...base,
        kind: "web_login" as const,
        web: {
          url: entry.url,
          username: entry.username,
          password: entry.password,
          notes: entry.notes ?? "",
        },
      };
    case "ssh_key":
      return {
        ...base,
        kind: "ssh_key" as const,
        ssh: {
          host: entry.host,
          username: entry.username,
          privateKey: entry.private_key,
          passphrase: entry.passphrase ?? "",
        },
      };
    case "api_token":
      return {
        ...base,
        kind: "api_token" as const,
        api: { service: entry.service, token: entry.token },
      };
    case "database":
      return {
        ...base,
        kind: "database" as const,
        db: {
          host: entry.host,
          port: String(entry.port),
          dbType: entry.db_type,
          databaseName: entry.database_name,
          username: entry.username,
          password: entry.password,
        },
      };
    case "network_wifi":
      return {
        ...base,
        kind: "network_wifi" as const,
        wifi: {
          ssid: entry.ssid,
          encryptionType: entry.encryption_type,
          password: entry.password,
        },
      };
    case "secure_note":
      return {
        ...base,
        kind: "secure_note" as const,
        note: { content: entry.content },
      };
  }
}

export function NewSecretModal({
  open,
  loading,
  mode = "create",
  editEntry,
  onClose,
  onSubmit,
  onUpdate,
  onOpenGenerator,
}: NewSecretModalProps) {
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
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && editEntry) {
      const state = entryToFormState(editEntry);
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
    } else {
      setKind("web_login");
      setTitle("");
      setFolder("");
      setTags([]);
      setExpiresAt("");
      setWeb(emptyWeb);
      setSsh(emptySsh);
      setApi(emptyApi);
      setDb(emptyDb);
      setWifi(emptyWifi);
      setNote(emptyNote);
    }
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, isEdit, editEntry]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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

  const inputClass =
    "w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent outline-none";

  const openGenerator = (apply: (pwd: string) => void) => {
    onOpenGenerator?.(apply);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="secret-form-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl">
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id="secret-form-title" className="font-mono text-sm font-semibold">
            {isEdit ? "Secret bearbeiten" : "Neues Secret"}
          </h2>
          <p className="mt-1 text-xs text-vault-muted">
            {isEdit
              ? `${SECRET_TYPE_LABELS[kind]} — Felder anpassen und speichern`
              : "Typ wählen und Felder ausfüllen"}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!isEdit && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => setKind(opt.kind)}
                  className={`rounded border px-2 py-2 text-left transition ${
                    kind === opt.kind
                      ? "border-vault-accent bg-vault-accent/15 text-vault-text"
                      : "border-vault-border text-vault-muted hover:border-vault-accent/50"
                  }`}
                >
                  <span className="block font-mono text-[11px] font-medium">
                    {SECRET_TYPE_LABELS[opt.kind]}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-70">{opt.description}</span>
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
            <Field label="Titel" required>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
                placeholder="z. B. Produktions-Server"
                required
              />
            </Field>

            <Field label="Ordner / Bereich">
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                className={inputClass}
                placeholder="z. B. Produktion, Kunden, Intern"
              />
            </Field>

            <Field label="Tags">
              <TagInput tags={tags} onChange={setTags} disabled={loading} />
            </Field>

            <Field label="Ablaufdatum / Gültig bis">
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={inputClass}
              />
            </Field>

            {kind === "web_login" && (
              <>
                <Field label="URL" required>
                  <input
                    value={web.url}
                    onChange={(e) => setWeb({ ...web, url: e.target.value })}
                    className={inputClass}
                    placeholder="https://… oder example.com"
                    required
                  />
                </Field>
                <Field label="Benutzername" required>
                  <input
                    value={web.username}
                    onChange={(e) => setWeb({ ...web, username: e.target.value })}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label="Passwort" required>
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
                <Field label="Notizen">
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
                <Field label="Server / IP" required>
                  <input
                    value={ssh.host}
                    onChange={(e) => setSsh({ ...ssh, host: e.target.value })}
                    className={inputClass}
                    placeholder="10.0.0.1 oder host.example.com"
                    required
                  />
                </Field>
                <Field label="Benutzername" required>
                  <input
                    value={ssh.username}
                    onChange={(e) => setSsh({ ...ssh, username: e.target.value })}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label="Private Key" required>
                  <textarea
                    value={ssh.privateKey}
                    onChange={(e) => setSsh({ ...ssh, privateKey: e.target.value })}
                    rows={5}
                    className={`${inputClass} text-xs`}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    required
                  />
                </Field>
                <Field label="Passphrase">
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
                <Field label="Service-Name" required>
                  <input
                    value={api.service}
                    onChange={(e) => setApi({ ...api, service: e.target.value })}
                    className={inputClass}
                    placeholder="z. B. GitHub, AWS, Stripe"
                    required
                  />
                </Field>
                <Field label="API-Key / Token" required>
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
                  <Field label="Host / IP" required>
                    <input
                      value={db.host}
                      onChange={(e) => setDb({ ...db, host: e.target.value })}
                      className={inputClass}
                      placeholder="10.0.0.5"
                      required
                    />
                  </Field>
                  <Field label="Port" required>
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
                  <Field label="DB-Typ" required>
                    <select
                      value={db.dbType}
                      onChange={(e) => setDb({ ...db, dbType: e.target.value })}
                      className={inputClass}
                      required
                    >
                      {DB_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Datenbank-Name" required>
                  <input
                    value={db.databaseName}
                    onChange={(e) => setDb({ ...db, databaseName: e.target.value })}
                    className={inputClass}
                    placeholder="production"
                    required
                  />
                </Field>
                <Field label="Benutzername" required>
                  <input
                    value={db.username}
                    onChange={(e) => setDb({ ...db, username: e.target.value })}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label="Passwort" required>
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
                <Field label="SSID" required>
                  <input
                    value={wifi.ssid}
                    onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })}
                    className={inputClass}
                    placeholder="CorpNet-Guest"
                    required
                  />
                </Field>
                <Field label="Verschlüsselung" required>
                  <select
                    value={wifi.encryptionType}
                    onChange={(e) => setWifi({ ...wifi, encryptionType: e.target.value })}
                    className={inputClass}
                    required
                  >
                    {WIFI_ENCRYPTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Passwort / Key" required>
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
              <Field label="Inhalt" required>
                <textarea
                  value={note.content}
                  onChange={(e) => setNote({ content: e.target.value })}
                  rows={12}
                  className={`${inputClass} min-h-[200px] resize-y text-xs leading-relaxed`}
                  placeholder="Config-Dateien, Runbooks, sensible Notizen…"
                  required
                />
              </Field>
            )}
          </form>
        </div>

        <footer className="flex gap-2 border-t border-vault-border px-5 py-4">
          <button
            type="submit"
            form="secret-form"
            disabled={loading || !canSubmit}
            className="flex-1 rounded bg-vault-accent py-2 font-mono text-xs text-white hover:bg-vault-accent-hover disabled:opacity-50"
          >
            {loading
              ? isEdit
                ? "Verschlüsseln & Aktualisieren…"
                : "Verschlüsseln & Speichern…"
              : "Speichern"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-vault-border px-4 py-2 font-mono text-xs text-vault-muted hover:text-vault-text"
          >
            Abbrechen
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] text-vault-muted">
        {label}
        {required && " *"}
      </span>
      {children}
    </label>
  );
}
