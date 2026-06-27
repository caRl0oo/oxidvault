/**
 * OxidVault Browser Extension — Phase 3 + MFA bridge
 * Routes page hostname lookups to the Native-Messaging host (least privilege).
 *
 * Classic MV3 service worker (no "type": "module") — top-level await is invalid here
 * and causes "Service worker registration failed. Status code: 3".
 */

const HOST_NAME = "com.oxidvault.app";
const LOG_PREFIX = "[OxidVault]";

function disconnectNativePort(port) {
  try {
    port.disconnect();
  } catch (err) {
    console.debug(LOG_PREFIX + " Native port already closed:", err);
  }
}

/**
 * @param {object} payload Native-messaging JSON body
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
function queryNativeHost(payload, waitMs = 10000) {

  return new Promise(function (resolve) {
    const port = chrome.runtime.connectNative(HOST_NAME);

    if (chrome.runtime.lastError) {
      resolve({
        status: "error",
        error: chrome.runtime.lastError.message,
      });
      return;
    }

    const timeoutId = setTimeout(function () {
      disconnectNativePort(port);
      resolve({
        status: "error",
        error: "native host timeout after " + waitMs / 1000 + "s",
      });
    }, waitMs);

    port.onMessage.addListener(function (message) {
      clearTimeout(timeoutId);
      disconnectNativePort(port);
      resolve(message);
    });

    port.onDisconnect.addListener(function () {
      clearTimeout(timeoutId);
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({
          status: "error",
          error: err.message,
        });
      }
    });

    port.postMessage(payload);
  });
}

async function handleGetLogin(hostname, sendResponse) {
  try {
    const response = await queryNativeHost({ action: "get_login", url: hostname });
    if (response?.status === "ok") {
      console.log(LOG_PREFIX + " Credentials found for " + hostname);
    }
    sendResponse(response);
  } catch (err) {
    console.debug(LOG_PREFIX + " GET_LOGIN failed:", err);
    sendResponse({ status: "error", error: String(err) });
  }
}

async function handleVaultStatus(sendResponse) {
  try {
    const response = await queryNativeHost({ action: "vault_status" });
    sendResponse(response);
  } catch (err) {
    console.debug(LOG_PREFIX + " VAULT_STATUS failed:", err);
    sendResponse({ status: "error", error: String(err) });
  }
}

async function handleRequestUnlock(sendResponse) {
  try {
    const status = await queryNativeHost({ action: "vault_status" });
    if (status?.minimized) {
      sendResponse({
        status: "locked",
        success: false,
        locked: true,
        minimized: true,
        mfa_required: status.mfa_required ?? false,
      });
      return;
    }

    const response = await queryNativeHost({ action: "request_unlock" });
    sendResponse(response);
  } catch (err) {
    console.debug(LOG_PREFIX + " REQUEST_UNLOCK failed:", err);
    sendResponse({ status: "error", error: String(err) });
  }
}

async function handleOpenNewSecret(password, sendResponse) {
  try {
    const response = await queryNativeHost({ action: "open_new_secret", password });
    sendResponse(response);
  } catch (err) {
    console.debug(LOG_PREFIX + " OPEN_NEW_SECRET failed:", err);
    sendResponse({ status: "error", error: String(err) });
  }
}

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message?.type === "GET_LOGIN" && message?.hostname) {
    console.log(LOG_PREFIX + " get_login for", message.hostname);
    void handleGetLogin(message.hostname, sendResponse);
    return true;
  }

  if (message?.type === "VAULT_STATUS") {
    void handleVaultStatus(sendResponse);
    return true;
  }

  if (message?.type === "REQUEST_UNLOCK") {
    void handleRequestUnlock(sendResponse);
    return true;
  }

  if (message?.type === "OPEN_NEW_SECRET" && typeof message.password === "string") {
    void handleOpenNewSecret(message.password, sendResponse);
    return true;
  }

  return false;
});

async function runStartupPing() {
  try {
    const pingResponse = await queryNativeHost({ action: "ping" });
    if (pingResponse?.status === "pong") {
      console.log(LOG_PREFIX + " Ping/Pong E2E OK");
    }
  } catch (err) {
    console.debug(LOG_PREFIX + " Startup ping failed:", err);
  }
}

// sonar-disable-next-line javascript:S7785 -- classic MV3 SW: top-level await needs "type":"module" and breaks registration (status 3)
runStartupPing();
