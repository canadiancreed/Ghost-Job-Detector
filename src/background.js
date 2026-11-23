/* Background: shows the current listing's score on the toolbar icon, per tab. */
"use strict";

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId === undefined || !msg || typeof msg !== "object") return undefined;
  if (msg.type === "GJ_SCORE") {
    browser.action.setBadgeText({ tabId, text: String(msg.score) });
    browser.action.setBadgeBackgroundColor({ tabId, color: msg.color || "#666" });
    browser.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    browser.action.setTitle({ tabId, title: `Ghost risk: ${msg.score}/100` });
  } else if (msg.type === "GJ_CLEAR") {
    browser.action.setBadgeText({ tabId, text: "" });
    browser.action.setTitle({ tabId, title: "Ghost Job Detector" });
  }
  return undefined;
});

// When a tab navigates to a new page, clear any stale badge.
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) {
    browser.action.setBadgeText({ tabId, text: "" });
  }
});
