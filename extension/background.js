//console.log("backgroudn.js loaded");
//        chrome.runtime.onMessage.addListener( (request, sender, sendResponse) => {
//            if(request.action == "PROMPT"){
//             const callDeepSeek = async (prompt, sendResponse) => {
//                try {
//                   const res = await fetch("http://localhost:3001/generate", {
//                        method: "POST",
//                        headers: { "Content-Type": "application/json" },
//                        body: JSON.stringify({
//                        model: "deepseek-r1:8b",
//                        prompt: prompt
//                        })
//                    });
//
//
//                         const data = await res.json();
//
//                                 console.log("LLM output text:", data.output);
//
//                                 sendResponse({ result: data });
//                }
//                catch(err) {
//                    console.error("DeepSeek fetch error:", err);
//                    sendResponse({ success: false, error: err.message });
//                }
//               };
//                callDeepSeek(request.message, sendResponse);
//                return true; // ✅ keep channel open for async
//                }
//            });
// background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log("Agentic Web Copilot installed");
});

// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ status: "ok" });
    return;
  }

  if (message.action === "callLLM") {
    fetch(message.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.data)
    })
    .then(response => response.json())
    .then(data => {
      sendResponse({ data: data });
    })
    .catch(error => {
      sendResponse({ error: error.message });
    });

    return true; // Keep message channel open for async response
  }
});
