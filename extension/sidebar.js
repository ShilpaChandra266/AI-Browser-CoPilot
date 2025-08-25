// popup.js

const PROXY_URL = "http://localhost:3000/api/chat"; // your proxy
const LOCAL_MODEL_ID = "gpt-oss:20b";                  // your local model id
const MAX_STEPS = 6;

const chatBox = document.getElementById("chat-box");
const inputField = document.getElementById("user-input");
const sendBtn = document.getElementById("sendBtn");
const statusEl = document.getElementById("status");

function addMessage(text, who = "agent") {
  const div = document.createElement("div");
  div.className = `message ${who}`;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function log(message, data = null) {
  // Send logs to background script for better debugging
  chrome.runtime.sendMessage({
    action: "log",
    message,
    data
  });

  // Also show in popup if log box exists
  const logBox = document.getElementById("logs");
  if (logBox) {
    let entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (data) {
      try {
        entry += " " + JSON.stringify(data, null, 2);
      } catch {
        entry += " " + data.toString();
      }
    }
    logBox.textContent += entry + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  }
}

function sanitizeUrl(u) {
  try {
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const url = new URL(u);
    return url.toString();
  } catch {
    return null;
  }
}

async function callLLM(messages, temperature = 0) {
  log("LLM call Message:", messages);

  try {
    // Use chrome.runtime.sendMessage to communicate with background script
    return new Promise((resolve, reject) => {
      const payload = {
        action: "callLLM",
        url: PROXY_URL,
        data: {
          model: LOCAL_MODEL_ID,
          messages,
          temperature
        }
      };

      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          log("Chrome runtime error:", chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response && response.error) {
          log("LLM call error:", response.error);
          reject(new Error(response.error));
          return;
        }

        if (!response || !response.data) {
          log("Invalid response:", response);
          reject(new Error("Invalid response from background script"));
          return;
        }

        const data = response.data;
        log("LLM response:", data);

        // Return the full response data for parsing
        resolve(data);
      });
    });
  } catch (error) {
    log("callLLM error:", error.message);
    throw error;
  }
}

function parseAgentResponse(data) {
  log("Parsing agent response:", data);

  try {
    // Handle different response formats
    let content = "";
    let toolCalls = null;

    // Extract content and tool_calls from various response formats
    if (data?.message) {
      content = data.message.content || "";
      toolCalls = data.message.tool_calls;
    } else if (data?.choices && data.choices[0]?.message) {
      const message = data.choices[0].message;
      content = message.content || "";
      toolCalls = message.tool_calls;
    } else if (typeof data === "string") {
      content = data;
    }

    // If there are tool calls, convert to our expected format
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      if (toolCall.function) {
        const result = {
          tool: toolCall.function.name,
          args: toolCall.function.arguments
        };
        log("Parsed tool call:", result);
        return result;
      }
    }

    // Try to parse content as JSON (legacy format)
    if (content) {
      // Be tolerant if the model adds prose; grab first {...} JSON block
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        log("Parsed JSON from content:", parsed);
        return parsed;
      }
    }

    // If no tool calls or JSON found, treat as final response
    log("No tool calls found, treating as final response");
    return { final: content || "No response content found" };

  } catch (error) {
    log("Error parsing agent response:", error.message);
    throw new Error("Failed to parse agent response: " + error.message);
  }
}

async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        log("Error getting active tab:", chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(tabs[0] || null);
      }
    });
  });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Add timeout to prevent hanging
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000); // 10 second timeout
  });
}

// NEW: Function to ensure content script is injected
async function ensureContentScript(tabId) {
  try {
    // First, try to ping the existing content script
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "ping" }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });

    // If content script responds, we're good
    if (response) {
      log("Content script already available");
      return true;
    }

    // Otherwise, inject the content script
    log("Injecting content script...");
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });

    // Wait a moment for injection to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    log("Content script injected successfully");
    return true;
  } catch (error) {
    log("Error ensuring content script:", error.message);
    return false;
  }
}

async function getPageText(tabId) {
  // Ensure content script is available
  const scriptReady = await ensureContentScript(tabId);
  if (!scriptReady) {
    log("Failed to ensure content script is available");
    return { text: "", url: "" };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: "getPageText" }, (resp) => {
      if (chrome.runtime.lastError) {
        log("Error getting page text:", chrome.runtime.lastError.message);
        resolve({ text: "", url: "" });
      } else if (!resp?.ok) {
        log("Content script returned error:", resp);
        resolve({ text: "", url: "" });
      } else {
        log("Successfully got page text");
        resolve({ text: resp.text || "", url: resp.url || "" });
      }
    });
  });
}

async function runFillForm(tabId, fields, submit) {
  // Ensure content script is available
  const scriptReady = await ensureContentScript(tabId);
  if (!scriptReady) {
    return { ok: false, error: "Content script not available" };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: "fillForm", payload: { fields, submit } },
      (resp) => {
        if (chrome.runtime.lastError) {
          log("Error filling form:", chrome.runtime.lastError.message);
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else if (!resp?.ok) {
          resolve({ ok: false, error: resp?.error || "Unknown" });
        } else {
          resolve({ ok: true, result: resp.result });
        }
      }
    );
  });
}

// TOOL: summarize_page
async function toolSummarizePage(tabId, args) {
  const { text, url } = await getPageText(tabId);

  if (!text) {
    return { summary: "Unable to retrieve page content", url: url || "" };
  }

  const length = (args && args.length) || "short";

  const messages = [
    { role: "system", content: "You are a concise summarizer." },
    {
      role: "user",
      content:
        `Summarize the following web page in a ${length} paragraph.\n` +
        `URL: ${url}\n---\n${text.slice(0, 5000)}`
    }
  ];
  const response = await callLLM(messages, 0);

  // Extract text from response
  let summary = "";
  if (response?.message?.content) {
    summary = response.message.content;
  } else if (response?.choices?.[0]?.message?.content) {
    summary = response.choices[0].message.content;
  } else if (typeof response === "string") {
    summary = response;
  } else {
    summary = JSON.stringify(response);
  }

  return { summary: summary.trim(), url };
}

// TOOL: goto_website
async function toolGotoWebsite(tabId, args) {
  const clean = sanitizeUrl(args?.url || "");
  if (!clean) return { ok: false, error: "Invalid URL" };

  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { url: clean }, async (tab) => {
      if (chrome.runtime.lastError) {
        log("Error navigating to URL:", chrome.runtime.lastError.message);
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      try {
        await waitForTabLoad(tabId);
        const { text, url } = await getPageText(tabId);
        const preview = text.slice(0, 400);
        resolve({ ok: true, url, preview });
      } catch (error) {
        log("Error after navigation:", error.message);
        resolve({ ok: false, error: error.message });
      }
    });
  });
}

// TOOL: fill_form
async function toolFillForm(tabId, args) {
  const fields = args?.fields || {};
  const submit = !!args?.submit;

  if (submit) {
    // Safety confirmation
    const proceed = confirm(
      "The agent wants to SUBMIT a form on this page with provided values. Continue?"
    );
    if (!proceed) return { ok: false, error: "User declined submission." };
  }

  const result = await runFillForm(tabId, fields, submit);
  return result;
}

function toolset() {
  return `
You can use these tools by making tool calls:

1) goto_website: Navigate to a URL
   Arguments: { "url": "string" }
   Returns: { "ok": boolean, "url": string, "preview": string }

2) summarize_page: Summarize current page
   Arguments: { "length": "short|medium|long" }
   Returns: { "summary": string, "url": string }

3) fill_form: Fill form fields on current page
   Arguments: { "fields": { "<labelOrName>": "<value>", ... }, "submit": boolean }
   Returns: { "ok": boolean, "result": { "filled": array, "unmatched": array, "submitted": boolean }}

When you want to use a tool, make a tool call with the appropriate exact function name and arguments.
When you are finished with all tasks, provide your final response without tool calls.
Do NOT change the function names.
`;
}

async function runAgent(userText) {
  const tab = await getActiveTab();
  if (!tab) {
    addMessage("⚠️ Could not get active tab. Please make sure you have an active tab.", "agent");
    return;
  }

  const tabId = tab.id;

  const conversation = [
    {
      role: "system",
      content:
`You are an agent that helps users by using tools to interact with current web page or web pages.
Note that User is currently already on a web page and interacting.
Think step by step about what the user wants to accomplish.
Use tool calls when you need to perform actions.
When you're done with all tasks, provide your final answer without making any tool calls.`
    },
    { role: "system", content: toolset() },
    { role: "user", content: userText }
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    setStatus(`Agent step ${step}/${MAX_STEPS}...`);

    try {
      const response = await callLLM(conversation, 0);
      let action;

      try {
        action = parseAgentResponse(response);
      } catch (e) {
        addMessage("⚠️ Agent returned unparseable response. Stopping.", "agent");
        log("Parse error:", e.message);
        log("Raw response:", response);
        break;
      }

      // If agent is done
      if (action.final) {
        addMessage(action.final, "agent");
        setStatus("");
        return;
      }

      if (!action.tool) {
        addMessage("⚠️ Agent did not specify a tool or final answer.", "agent");
        log("Invalid action:", action);
        break;
      }

      // Execute tool
      let toolResult;
      try {
        if (action.tool === "summarize_page") {
          toolResult = await toolSummarizePage(tabId, action.args || {});
        } else if (action.tool === "goto_website") {
          toolResult = await toolGotoWebsite(tabId, action.args || {});
        } else if (action.tool === "fill_form") {
          toolResult = await toolFillForm(tabId, action.args || {});
        } else {
          toolResult = { error: `Unknown tool: ${action.tool}` };
        }
      } catch (e) {
        toolResult = { error: String(e) };
        log("Tool execution error:", e.message);
      }

      // Show a small trace in the UI
      addMessage(`🔧 ${action.tool} → ${JSON.stringify(toolResult, null, 2)}`, "agent");

      // Feed back to the agent
      conversation.push({
        role: "assistant",
        content: "",
        tool_calls: [{
          function: {
            name: action.tool,
            arguments: action.args || {}
          }
        }]
      });
      conversation.push({
        role: "user",
        content: `Tool result: ${JSON.stringify(toolResult)}`
      });

    } catch (error) {
      addMessage(`⚠️ Error in step ${step}: ${error.message}`, "agent");
      log("Step error:", error.message);
      break;
    }
  }

  setStatus("");
  addMessage("⚠️ Reached max steps or failed. You can try again.", "agent");
}

// UI wiring
sendBtn.addEventListener("click", async () => {
  const msg = inputField.value.trim();
  if (!msg) return;
  addMessage(msg, "user");
  inputField.value = "";

  try {
    await runAgent(msg);
  } catch (error) {
    addMessage(`⚠️ Error: ${error.message}`, "agent");
    log("runAgent error:", error.message);
    setStatus("");
  }
});

inputField.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

// Check if background script is available on startup
chrome.runtime.sendMessage({ action: "ping" }, (response) => {
  if (chrome.runtime.lastError) {
    log("Background script not available:", chrome.runtime.lastError.message);
    addMessage("⚠️ Background script not available. Extension may not work properly.", "agent");
  } else {
    log("Background script connection established");
  }
});