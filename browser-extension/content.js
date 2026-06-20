/**
 * OxidVault Browser Extension — Phase 3
 * Detects login forms and requests credentials for the current hostname only.
 */

const LOG_PREFIX = "[OxidVault]";
let autofillAttempted = false;

function hasPasswordField() {
  return Boolean(document.querySelector('input[type="password"]'));
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
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findUsernameInput(passwordInput) {
  const root = passwordInput.closest("form") ?? document;

  const selectors = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[name*="user" i]',
    'input[name*="login" i]',
    'input[name*="email" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[type="text"]',
  ];

  for (const selector of selectors) {
    const candidate = root.querySelector(selector);
    if (candidate && candidate !== passwordInput) {
      return candidate;
    }
  }

  return null;
}

function fillCredentials(username, password) {
  const passwordInput = document.querySelector('input[type="password"]');
  if (!passwordInput) {
    return;
  }

  const usernameInput = findUsernameInput(passwordInput);

  if (usernameInput && username) {
    setNativeValue(usernameInput, username);
  }

  if (password) {
    setNativeValue(passwordInput, password);
  }

  console.log(`${LOG_PREFIX} AutoFill applied for ${globalThis.location.hostname}`);
}

function requestAutofill() {
  if (autofillAttempted || !hasPasswordField()) {
    return;
  }

  autofillAttempted = true;
  const hostname = globalThis.location.hostname;
  if (!hostname) {
    return;
  }

  chrome.runtime.sendMessage(
    { type: "GET_LOGIN", hostname },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn(`${LOG_PREFIX} GET_LOGIN failed:`, chrome.runtime.lastError.message);
        autofillAttempted = false;
        return;
      }

      if (response?.status === "ok") {
        fillCredentials(response.username, response.password);
      } else if (response?.status === "not_found") {
        console.log(`${LOG_PREFIX} No vault entry for ${hostname}`);
      } else if (response?.status === "locked") {
        console.log(`${LOG_PREFIX} Vault locked — unlock OxidVault desktop app`);
      } else if (response?.status === "unavailable") {
        console.log(`${LOG_PREFIX} Desktop app not running`);
        autofillAttempted = false;
      } else if (response?.status === "error") {
        console.warn(`${LOG_PREFIX} Host error:`, response.error ?? response);
        autofillAttempted = false;
      }
    }
  );
}

function scanForLoginForm() {
  if (hasPasswordField()) {
    requestAutofill();
  }
}

scanForLoginForm();

const observer = new MutationObserver(() => {
  if (!autofillAttempted && hasPasswordField()) {
    requestAutofill();
  }
});

if (document.documentElement) {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
