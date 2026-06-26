/**
 * OxidVault extension popup — vault status + WASM password generator.
 * Generation uses the same Rust code as the desktop app (vault-generator via WASM).
 */

const THEME_STORAGE_KEY = "oxidvault-theme";
const DEFAULT_OPTIONS = {
  length: 24,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
};

const statusEl = document.getElementById("status");
const subtitleEl = document.getElementById("subtitle");
const unlockBtn = document.getElementById("unlockBtn");
const themeSelect = document.getElementById("themeSelect");
const generatorPanel = document.getElementById("generatorPanel");
const lengthSlider = document.getElementById("lengthSlider");
const lengthValue = document.getElementById("lengthValue");
const optUpper = document.getElementById("optUpper");
const optLower = document.getElementById("optLower");
const optDigits = document.getElementById("optDigits");
const optSymbols = document.getElementById("optSymbols");
const passwordOutput = document.getElementById("passwordOutput");
const generatorError = document.getElementById("generatorError");
const regenerateBtn = document.getElementById("regenerateBtn");
const copyBtn = document.getElementById("copyBtn");
const saveBtn = document.getElementById("saveBtn");

/** @type {Promise<{ generatePassword: (opts: object) => string }> | null} */
let wasmModulePromise = null;
let currentPassword = "";
let generating = false;

function setStatus(className, message) {
  statusEl.className = `status ${className}`;
  statusEl.textContent = message;
}

function readOptions() {
  return {
    length: Number(lengthSlider.value),
    uppercase: optUpper.checked,
    lowercase: optLower.checked,
    digits: optDigits.checked,
    symbols: optSymbols.checked,
  };
}

function hasCharset(options) {
  return options.uppercase || options.lowercase || options.digits || options.symbols;
}

function setGeneratorLoading(loading) {
  generating = loading;
  generatorPanel.classList.toggle("loading", loading);
  regenerateBtn.disabled = loading || !hasCharset(readOptions());
  copyBtn.disabled = loading || !currentPassword;
  saveBtn.disabled = loading || !currentPassword;
}

function showGeneratorError(message) {
  if (!message) {
    generatorError.hidden = true;
    generatorError.textContent = "";
    return;
  }
  generatorError.hidden = false;
  generatorError.textContent = message;
}

function loadWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = import("./pkg/vault_wasm.js")
      .then(async (mod) => {
        await mod.default();
        return mod;
      })
      .catch((err) => {
        wasmModulePromise = null;
        throw err;
      });
  }
  return wasmModulePromise;
}

async function runGenerate(options = readOptions()) {
  if (!hasCharset(options)) {
    currentPassword = "";
    passwordOutput.value = "";
    showGeneratorError("Mindestens ein Zeichensatz muss aktiv sein.");
    setGeneratorLoading(false);
    return;
  }

  setGeneratorLoading(true);
  showGeneratorError(null);

  try {
    const wasm = await loadWasmModule();
    currentPassword = wasm.generatePassword(options);
    passwordOutput.value = currentPassword;
  } catch (err) {
    currentPassword = "";
    passwordOutput.value = "";
    showGeneratorError(
      err instanceof Error ? err.message : "WASM-Generator konnte nicht geladen werden."
    );
  } finally {
    setGeneratorLoading(false);
  }
}

function renderStatus(response) {
  if (response?.status === "unavailable") {
    subtitleEl.textContent = "Desktop-App nicht erreichbar";
    setStatus(
      "status-unavailable",
      "Starte OxidVault auf diesem Rechner, um AutoFill und Speichern zu nutzen."
    );
    unlockBtn.hidden = true;
    return;
  }

  if (response?.status === "mfa_failed") {
    subtitleEl.textContent = "MFA fehlgeschlagen";
    setStatus(
      "status-error",
      response.error ??
        "Der MFA-Code in der Desktop-App war ungültig. Bitte erneut in OxidVault entsperren."
    );
    unlockBtn.hidden = false;
    unlockBtn.textContent = "OxidVault erneut öffnen";
    return;
  }

  if (response?.success === true && response?.locked === false) {
    subtitleEl.textContent = "Tresor entsperrt";
    setStatus("status-ok", "AutoFill ist bereit. Login-Seiten werden automatisch erkannt.");
    unlockBtn.hidden = true;
    return;
  }

  if (response?.mfa_required) {
    subtitleEl.textContent = "Zwei-Faktor-Authentifizierung aktiv";
    setStatus(
      "status-mfa",
      "Entsperre OxidVault in der Desktop-App mit Master-Passwort und MFA-Code."
    );
    unlockBtn.hidden = false;
    unlockBtn.textContent = "OxidVault öffnen";
    return;
  }

  if (response?.locked) {
    subtitleEl.textContent = "Tresor gesperrt";
    setStatus("status-locked", "Entsperre OxidVault in der Desktop-App, um Secrets zu speichern.");
    unlockBtn.hidden = false;
    unlockBtn.textContent = "OxidVault öffnen";
    return;
  }

  subtitleEl.textContent = "Status unbekannt";
  setStatus("status-unavailable", "Verbindung zum Host fehlgeschlagen.");
  unlockBtn.hidden = true;
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "VAULT_STATUS" }, (response) => {
    if (chrome.runtime.lastError) {
      subtitleEl.textContent = "Verbindungsfehler";
      setStatus("status-unavailable", chrome.runtime.lastError.message);
      unlockBtn.hidden = true;
      return;
    }
    renderStatus(response);
  });
}

async function applyTheme(themeId) {
  document.documentElement.dataset.theme = themeId;
  themeSelect.value = themeId;
  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: themeId });
  } catch {
    /* ignore */
  }
}

async function restoreTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const themeId = stored[THEME_STORAGE_KEY] ?? "oxid";
    await applyTheme(themeId);
  } catch {
    await applyTheme("oxid");
  }
}

unlockBtn.addEventListener("click", () => {
  unlockBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "REQUEST_UNLOCK" }, () => {
    unlockBtn.disabled = false;
    refreshStatus();
  });
});

themeSelect.addEventListener("change", () => {
  void applyTheme(themeSelect.value);
});

lengthSlider.addEventListener("input", () => {
  lengthValue.textContent = lengthSlider.value;
});

lengthSlider.addEventListener("change", () => {
  if (!generating) {
    void runGenerate();
  }
});

for (const input of [optUpper, optLower, optDigits, optSymbols]) {
  input.addEventListener("change", () => {
    if (!generating) {
      void runGenerate();
    }
  });
}

regenerateBtn.addEventListener("click", () => {
  void runGenerate();
});

copyBtn.addEventListener("click", () => {
  if (!currentPassword) {
    return;
  }
  navigator.clipboard
    .writeText(currentPassword)
    .then(() => {
      copyBtn.textContent = "Kopiert!";
      globalThis.setTimeout(() => {
        copyBtn.textContent = "Kopieren";
      }, 1500);
    })
    .catch(() => {
      showGeneratorError("Zwischenablage nicht verfügbar.");
    });
});

saveBtn.addEventListener("click", () => {
  if (!currentPassword) {
    return;
  }
  saveBtn.disabled = true;
  chrome.runtime.sendMessage(
    { type: "OPEN_NEW_SECRET", password: currentPassword },
    (response) => {
      saveBtn.disabled = false;
      if (chrome.runtime.lastError) {
        showGeneratorError(chrome.runtime.lastError.message);
        return;
      }
      if (response?.status === "locked") {
        showGeneratorError("Tresor gesperrt — bitte zuerst in OxidVault entsperren.");
        refreshStatus();
        return;
      }
      if (response?.status === "error") {
        showGeneratorError(response.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      showGeneratorError(null);
      subtitleEl.textContent = "Desktop-App geöffnet";
      setStatus("status-ok", "Neues Secret-Formular in OxidVault wird vorbefüllt.");
      refreshStatus();
    }
  );
});

void restoreTheme();
refreshStatus();
void loadWasmModule()
  .then(() => runGenerate(DEFAULT_OPTIONS))
  .catch(() => {
    showGeneratorError("WASM-Modul fehlt — bitte scripts/build-wasm.ps1 ausführen.");
    generatorPanel.classList.remove("loading");
  });
