//console.log("content.js loaded");
//class AIExtension{
//    constructor(){
//        this.handleRequest();
//    }
//    handleRequest(){
//        chrome.runtime.onMessage.addListener( async (request, sender, response) => {
//            if(request.action == "PROMPT"){
//                this.promptoai(request.message);
//                console.log(request.message);
//            }
//        })
//    }
//    promptoai(prompt){
//        console.log("we are prompting to AI");
//        fetch("http://localhost:11434/api/generate", {
//              method: "POST",
//              headers: { "Content-Type": "application/json" },
//              body: JSON.stringify({
//                model: "deepseek-r1:8b",
//                prompt: prompt
//              })
//            })
//              .then(async (res) => {
//                const text = await res.text(); // Ollama streams text, not always JSON
//                console.log("Response: ");
//                //sendResponse({ success: true, data: text });
//              })
//              .catch((err) => {
//                console.error("DeepSeek fetch error:", err);
//                //sendResponse({ success: false, error: err.message });
//              });
//
//            return true; // ✅ keep channel open for async
//    }
//}
//const aie = new AIExtension();
