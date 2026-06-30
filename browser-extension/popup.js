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
    showGeneratorError(chrome.i18n.getMessage("error_charset_required"));
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
      err instanceof Error ? err.message : chrome.i18n.getMessage("error_wasm_generator_load_failed")
    );
  } finally {
    setGeneratorLoading(false);
  }
}

function setSubtitleAndStatus(subtitleKey, statusClass, statusKey) {
  subtitleEl.textContent = chrome.i18n.getMessage(subtitleKey);
  setStatus(statusClass, chrome.i18n.getMessage(statusKey));
}

function applyMinimizedVaultUi(response, config) {
  const minimized = response?.minimized === true;
  subtitleEl.textContent = chrome.i18n.getMessage(
    minimized ? config.subtitleMinimized : config.subtitle
  );
  setStatus(
    config.statusClass,
    chrome.i18n.getMessage(minimized ? config.statusMinimized : config.status)
  );
  unlockBtn.hidden = minimized;
  if (!minimized) {
    unlockBtn.textContent = chrome.i18n.getMessage("btn_open_oxidvault");
  }
}

function renderUnavailableStatus() {
  setSubtitleAndStatus(
    "subtitle_desktop_unavailable",
    "status-unavailable",
    "status_desktop_unavailable"
  );
  unlockBtn.hidden = true;
}

function renderMfaFailedStatus(response) {
  subtitleEl.textContent = chrome.i18n.getMessage("subtitle_mfa_failed");
  setStatus(
    "status-error",
    response.error ?? chrome.i18n.getMessage("status_mfa_failed_default")
  );
  unlockBtn.hidden = false;
  unlockBtn.textContent = chrome.i18n.getMessage("btn_reopen_oxidvault");
}

function renderUnlockedStatus() {
  setSubtitleAndStatus("subtitle_vault_unlocked", "status-ok", "status_vault_unlocked");
  unlockBtn.hidden = true;
}

function renderMfaRequiredStatus(response) {
  applyMinimizedVaultUi(response, {
    subtitleMinimized: "subtitle_mfa_active_minimized",
    subtitle: "subtitle_mfa_active",
    statusClass: "status-mfa",
    statusMinimized: "status_mfa_restore_window",
    status: "status_mfa_unlock_desktop",
  });
}

function renderLockedStatus(response) {
  applyMinimizedVaultUi(response, {
    subtitleMinimized: "subtitle_vault_locked_minimized",
    subtitle: "subtitle_vault_locked",
    statusClass: "status-locked",
    statusMinimized: "status_locked_restore_window",
    status: "status_locked_unlock_desktop",
  });
}

function renderUnknownStatus() {
  setSubtitleAndStatus(
    "subtitle_unknown_status",
    "status-unavailable",
    "status_host_connection_failed"
  );
  unlockBtn.hidden = true;
}

const STATUS_RENDERERS = [
  { match: (response) => response?.status === "unavailable", render: renderUnavailableStatus },
  { match: (response) => response?.status === "mfa_failed", render: renderMfaFailedStatus },
  {
    match: (response) => response?.success === true && response?.locked === false,
    render: renderUnlockedStatus,
  },
  { match: (response) => response?.mfa_required, render: renderMfaRequiredStatus },
  { match: (response) => response?.locked, render: renderLockedStatus },
];

function renderStatus(response) {
  const handler = STATUS_RENDERERS.find((entry) => entry.match(response));
  (handler?.render ?? renderUnknownStatus)(response);
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "VAULT_STATUS" }, (response) => {
    if (chrome.runtime.lastError) {
      subtitleEl.textContent = chrome.i18n.getMessage("subtitle_connection_error");
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
      copyBtn.textContent = chrome.i18n.getMessage("btn_copied");
      globalThis.setTimeout(() => {
        copyBtn.textContent = chrome.i18n.getMessage("btn_copy");
      }, 1500);
    })
    .catch(() => {
      showGeneratorError(chrome.i18n.getMessage("error_clipboard_unavailable"));
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
        showGeneratorError(chrome.i18n.getMessage("error_vault_locked_save"));
        refreshStatus();
        return;
      }
      if (response?.status === "error") {
        showGeneratorError(response.error ?? chrome.i18n.getMessage("error_save_failed"));
        return;
      }
      showGeneratorError(null);
      subtitleEl.textContent = chrome.i18n.getMessage("subtitle_desktop_opened");
      setStatus("status-ok", chrome.i18n.getMessage("status_new_secret_prefill"));
      refreshStatus();
    }
  );
});

void restoreTheme();
refreshStatus();
void loadWasmModule()
  .then(() => runGenerate(DEFAULT_OPTIONS))
  .catch(() => {
    showGeneratorError(chrome.i18n.getMessage("error_wasm_module_missing"));
    generatorPanel.classList.remove("loading");
  });

document.querySelectorAll("[data-i18n]").forEach((el) => {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
  const msg = chrome.i18n.getMessage(el.dataset.i18nAria);
  if (msg) el.setAttribute("aria-label", msg);
});
