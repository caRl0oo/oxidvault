/**
 * OxidVault Browser Extension — Phase 3
 * Routes page hostname lookups to the Native-Messaging host (least privilege).
 */

const HOST_NAME = "com.oxidvault.app";
const LOG_PREFIX = "[OxidVault]";

/**
 * @param {object} payload Native-messaging JSON body
 * @returns {Promise<object>}
 */
function queryNativeHost(payload) {
  return new Promise((resolve) => {
    const port = chrome.runtime.connectNative(HOST_NAME);

    if (chrome.runtime.lastError) {
      resolve({
        status: "error",
        error: chrome.runtime.lastError.message,
      });
      return;
    }

    const timeoutMs = 10_000;
    const timeoutId = setTimeout(() => {
      try {
        port.disconnect();
      } catch {
        // ignore
      }
      resolve({
        status: "error",
        error: `native host timeout after ${timeoutMs / 1000}s`,
      });
    }, timeoutMs);

    port.onMessage.addListener((message) => {
      clearTimeout(timeoutId);
      try {
        port.disconnect();
      } catch {
        // ignore
      }
      resolve(message);
    });

    port.onDisconnect.addListener(() => {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_LOGIN" || !message.hostname) {
    return false;
  }

  console.log(`${LOG_PREFIX} get_login for`, message.hostname);

  queryNativeHost({ action: "get_login", url: message.hostname }).then((response) => {
    if (response?.status === "ok") {
      console.log(`${LOG_PREFIX} Credentials found for ${message.hostname}`);
    }
    sendResponse(response);
  });

  return true;
});

// Phase 2 connectivity check on extension load
queryNativeHost({ action: "ping" }).await((response) => {
  if (response?.status === "pong") {
    console.log(`${LOG_PREFIX} Ping/Pong E2E OK`);
  }
});
