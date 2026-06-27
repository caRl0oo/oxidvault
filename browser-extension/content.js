/**
 * OxidVault Browser Extension — Phase 3 + MFA bridge
 * Detects login forms and requests credentials for the current hostname only.
 * Never requests or stores MFA codes — unlock happens in the desktop app.
 */

const LOG_PREFIX = "[OxidVault]";
const OBSERVER_TIMEOUT_MS = 3000;
const HIGHLIGHT_DURATION_MS = 500;
const PENDING_STORAGE_PREFIX = "oxidvault:pending:";
const UNLOCK_POLL_INTERVAL_MS = 2000;
const UNLOCK_POLL_MAX_ATTEMPTS = 60;

/** @type {{ username: string, password: string } | null} */
let cachedCredentials = null;
let usernameFillAttempted = false;
let passwordFillAttempted = false;
let getLoginInFlight = false;
let unlockPollTimer = null;

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="email" i]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[type="text"]',
];

function pendingStorageKey(hostname) {
  return `${PENDING_STORAGE_PREFIX}${hostname}`;
}

function readPendingCredentials(hostname) {
  try {
    const raw = sessionStorage.getItem(pendingStorageKey(hostname));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.username === "string" && typeof parsed?.password === "string") {
      return parsed;
    }
  } catch {
    /* ignore corrupt session data */
  }
  return null;
}

function storePendingCredentials(hostname, credentials) {
  try {
    sessionStorage.setItem(pendingStorageKey(hostname), JSON.stringify(credentials));
  } catch {
    /* private browsing / blocked storage */
  }
}

function clearPendingCredentials(hostname) {
  try {
    sessionStorage.removeItem(pendingStorageKey(hostname));
  } catch {
    /* ignore */
  }
}

function stopUnlockPolling() {
  if (unlockPollTimer !== null) {
    globalThis.clearInterval(unlockPollTimer);
    unlockPollTimer = null;
  }
}

function isVaultUnlocked(response) {
  return response?.success === true && response?.locked === false;
}

function startVaultStatusPolling(onUnlocked, maxAttempts = null) {
  stopUnlockPolling();

  let attempts = 0;
  unlockPollTimer = globalThis.setInterval(() => {
    attempts += 1;
    chrome.runtime.sendMessage({ type: "VAULT_STATUS" }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }

      if (isVaultUnlocked(response)) {
        stopUnlockPolling();
        onUnlocked?.();
        return;
      }

      if (maxAttempts !== null && attempts >= maxAttempts) {
        stopUnlockPolling();
      }
    });
  }, UNLOCK_POLL_INTERVAL_MS);
}

function pollVaultUnlocked(onUnlocked) {
  startVaultStatusPolling(onUnlocked, UNLOCK_POLL_MAX_ATTEMPTS);
}

function beginDesktopUnlock(onUnlocked) {
  chrome.runtime.sendMessage({ type: "VAULT_STATUS" }, (statusResponse) => {
    if (chrome.runtime.lastError) {
      console.warn(`${LOG_PREFIX} VAULT_STATUS failed:`, chrome.runtime.lastError.message);
      return;
    }

    if (statusResponse?.locked && statusResponse?.minimized) {
      pollVaultUnlocked(onUnlocked);
      return;
    }

    chrome.runtime.sendMessage({ type: "REQUEST_UNLOCK" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(`${LOG_PREFIX} REQUEST_UNLOCK failed:`, chrome.runtime.lastError.message);
        return;
      }

      if (isVaultUnlocked(response)) {
        onUnlocked();
        return;
      }

      pollVaultUnlocked(onUnlocked);
    });
  });
}

function findPasswordInput(root = document) {
  return root.querySelector('input[type="password"]');
}

function findUsernameInput(passwordInput) {
  const root = passwordInput?.closest("form") ?? document;

  for (const selector of USERNAME_SELECTORS) {
    const candidate = root.querySelector(selector);
    if (candidate && candidate !== passwordInput && candidate.type !== "password") {
      return candidate;
    }
  }

  return null;
}

function findStandaloneUsernameInput() {
  for (const selector of USERNAME_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (candidate && candidate.type !== "password") {
      return candidate;
    }
  }
  return null;
}

function detectLoginFields() {
  const passwordInput = findPasswordInput();
  const usernameInput = passwordInput
    ? findUsernameInput(passwordInput)
    : findStandaloneUsernameInput();

  return { passwordInput, usernameInput };
}

function hasActionableLoginField() {
  const { passwordInput, usernameInput } = detectLoginFields();
  return Boolean(passwordInput || usernameInput);
}

function dispatchInputEvents(element) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));

  try {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
      })
    );
  } catch {
    /* InputEvent unsupported in older engines */
  }
}

function setNativeValue(element, value) {
  if (!element) {
    return;
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value"
  );

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  dispatchInputEvents(element);
}

function highlightPasswordField(element) {
  const previous = {
    outline: element.style.outline,
    outlineOffset: element.style.outlineOffset,
    transition: element.style.transition,
  };

  element.style.transition = "outline-color 150ms ease";
  element.style.outline = "2px solid #22c55e";
  element.style.outlineOffset = "2px";

  globalThis.setTimeout(() => {
    element.style.outline = previous.outline;
    element.style.outlineOffset = previous.outlineOffset;
    element.style.transition = previous.transition;
  }, HIGHLIGHT_DURATION_MS);

  element.focus({ preventScroll: false });
}

/**
 * Fills only fields present on the page (supports split username/password steps).
 * @returns {boolean} Whether at least one field was filled.
 */
function fillCredentials(username, password) {
  const hostname = globalThis.location.hostname;
  const pending = readPendingCredentials(hostname);
  const resolvedUsername = username || pending?.username || "";
  const resolvedPassword = password || pending?.password || "";

  const { passwordInput, usernameInput } = detectLoginFields();
  let filled = false;

  if (usernameInput && resolvedUsername && usernameInput !== passwordInput) {
    setNativeValue(usernameInput, resolvedUsername);
    filled = true;
  }

  if (passwordInput && resolvedPassword) {
    setNativeValue(passwordInput, resolvedPassword);
    highlightPasswordField(passwordInput);
    filled = true;
  }

  if (!filled) {
    return false;
  }

  if (filled && resolvedUsername && resolvedPassword) {
    storePendingCredentials(hostname, {
      username: resolvedUsername,
      password: resolvedPassword,
    });
  }

  if (passwordInput && resolvedPassword) {
    passwordFillAttempted = true;
    if (usernameInput && resolvedUsername) {
      usernameFillAttempted = true;
      clearPendingCredentials(hostname);
    }
  } else if (usernameInput && resolvedUsername && resolvedPassword) {
    usernameFillAttempted = true;
    storePendingCredentials(hostname, {
      username: resolvedUsername,
      password: resolvedPassword,
    });
  }

  console.log(`${LOG_PREFIX} AutoFill applied for ${hostname}`);
  return true;
}

function credentialsForFill(response) {
  const hostname = globalThis.location.hostname;
  const pending = readPendingCredentials(hostname);

  return {
    username: response?.username || pending?.username || "",
    password: response?.password || pending?.password || "",
  };
}

function shouldRequestLogin() {
  const { passwordInput, usernameInput } = detectLoginFields();

  if (passwordInput && !passwordFillAttempted) {
    return true;
  }

  if (usernameInput && !usernameFillAttempted && !passwordInput) {
    return true;
  }

  return false;
}

function applyCachedCredentialsIfPossible() {
  if (!cachedCredentials) {
    const pending = readPendingCredentials(globalThis.location.hostname);
    if (pending) {
      cachedCredentials = pending;
    }
  }

  if (!cachedCredentials) {
    return false;
  }

  const { passwordInput } = detectLoginFields();
  if (passwordInput && !passwordFillAttempted) {
    return fillCredentials(cachedCredentials.username, cachedCredentials.password);
  }

  return false;
}

function handleLockedResponse(response) {
  if (response?.status === "mfa_failed") {
    console.warn(
      `${LOG_PREFIX} MFA failed:`,
      response.error ?? "MFA-Code in OxidVault ungültig."
    );
    return;
  }

  const onUnlocked = () => {
    getLoginInFlight = false;
    requestAutofill();
  };

  if (response?.minimized) {
    pollVaultUnlocked(onUnlocked);
    return;
  }

  beginDesktopUnlock(onUnlocked);
}

function requestAutofill() {
  if (getLoginInFlight || !shouldRequestLogin()) {
    return;
  }

  if (applyCachedCredentialsIfPossible()) {
    return;
  }

  const hostname = globalThis.location.hostname;
  if (!hostname) {
    return;
  }

  getLoginInFlight = true;

  chrome.runtime.sendMessage({ type: "GET_LOGIN", hostname }, (response) => {
    getLoginInFlight = false;

    if (chrome.runtime.lastError) {
      console.warn(`${LOG_PREFIX} GET_LOGIN failed:`, chrome.runtime.lastError.message);
      return;
    }

    if (response?.status === "ok" && response?.success !== false) {
      const credentials = credentialsForFill(response);
      cachedCredentials = credentials;
      storePendingCredentials(hostname, credentials);
      fillCredentials(credentials.username, credentials.password);
      return;
    }

    if (response?.status === "not_found") {
      console.log(`${LOG_PREFIX} No vault entry for ${hostname}`);
      return;
    }

    if (response?.status === "locked" || response?.status === "mfa_failed") {
      handleLockedResponse(response);
      return;
    }

    if (response?.status === "unavailable") {
      console.log(`${LOG_PREFIX} Desktop app not running`);
      return;
    }

    if (response?.status === "error") {
      console.warn(`${LOG_PREFIX} Host error:`, response.error ?? response);
    }
  });
}

function scanForLoginForm() {
  if (hasActionableLoginField()) {
    requestAutofill();
  }
}

function startLoginFieldWatcher() {
  scanForLoginForm();

  const deadline = Date.now() + OBSERVER_TIMEOUT_MS;

  const observer = new MutationObserver(() => {
    if (Date.now() > deadline) {
      observer.disconnect();
      return;
    }

    if (hasActionableLoginField()) {
      requestAutofill();
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  globalThis.setTimeout(() => observer.disconnect(), OBSERVER_TIMEOUT_MS);
}

startLoginFieldWatcher();
