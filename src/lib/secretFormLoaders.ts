// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { revealSecret } from "@/lib/ipc";
import type { SecretEntryPublic, SecretKind } from "@/types/vault";

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

type EditFormBase = {
  title: string;
  folder: string;
  tags: string[];
  expiresAt: string;
  web: typeof emptyWeb;
  ssh: typeof emptySsh;
  api: typeof emptyApi;
  db: typeof emptyDb;
  wifi: typeof emptyWifi;
  note: typeof emptyNote;
};

export type EditFormState = EditFormBase & { kind: SecretKind };

function editFormBase(entry: SecretEntryPublic): EditFormBase {
  return {
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
}

async function loadWebLoginState(
  entry: Extract<SecretEntryPublic, { type: "web_login" }>,
  base: EditFormBase,
): Promise<EditFormState> {
  const password = entry.has_password
    ? (await revealSecret(entry.id, "password")).value
    : "";
  const notes = entry.has_notes ? (await revealSecret(entry.id, "notes")).value : "";
  return {
    ...base,
    kind: "web_login",
    web: { url: entry.url, username: entry.username, password, notes },
  };
}

async function loadSshKeyState(
  entry: Extract<SecretEntryPublic, { type: "ssh_key" }>,
  base: EditFormBase,
): Promise<EditFormState> {
  const privateKey = entry.has_private_key
    ? (await revealSecret(entry.id, "private_key")).value
    : "";
  const passphrase = entry.has_passphrase
    ? (await revealSecret(entry.id, "passphrase")).value
    : "";
  return {
    ...base,
    kind: "ssh_key",
    ssh: { host: entry.host, username: entry.username, privateKey, passphrase },
  };
}

async function loadApiTokenState(
  entry: Extract<SecretEntryPublic, { type: "api_token" }>,
  base: EditFormBase,
): Promise<EditFormState> {
  const token = entry.has_token ? (await revealSecret(entry.id, "token")).value : "";
  return {
    ...base,
    kind: "api_token",
    api: { service: entry.service, token },
  };
}

async function loadDatabaseState(
  entry: Extract<SecretEntryPublic, { type: "database" }>,
  base: EditFormBase,
): Promise<EditFormState> {
  const password = entry.has_password
    ? (await revealSecret(entry.id, "password")).value
    : "";
  return {
    ...base,
    kind: "database",
    db: {
      host: entry.host,
      port: String(entry.port),
      dbType: entry.db_type,
      databaseName: entry.database_name,
      username: entry.username,
      password,
    },
  };
}

async function loadWifiState(
  entry: Extract<SecretEntryPublic, { type: "network_wifi" }>,
  base: EditFormBase,
): Promise<EditFormState> {
  const password = entry.has_password
    ? (await revealSecret(entry.id, "password")).value
    : "";
  return {
    ...base,
    kind: "network_wifi",
    wifi: {
      ssid: entry.ssid,
      encryptionType: entry.encryption_type,
      password,
    },
  };
}

async function loadSecureNoteState(
  entry: Extract<SecretEntryPublic, { type: "secure_note" }>,
  base: EditFormBase,
): Promise<EditFormState> {
  const content = entry.has_content ? (await revealSecret(entry.id, "content")).value : "";
  return {
    ...base,
    kind: "secure_note",
    note: { content },
  };
}

export async function loadEditFormState(entry: SecretEntryPublic): Promise<EditFormState> {
  const base = editFormBase(entry);

  switch (entry.type) {
    case "web_login":
      return loadWebLoginState(entry, base);
    case "ssh_key":
      return loadSshKeyState(entry, base);
    case "api_token":
      return loadApiTokenState(entry, base);
    case "database":
      return loadDatabaseState(entry, base);
    case "network_wifi":
      return loadWifiState(entry, base);
    case "secure_note":
      return loadSecureNoteState(entry, base);
  }
}
