const express = require("express");
//const fetch = require("node-fetch"); // or built-in fetch in Node 18+
const bodyParser = require("body-parser");
const app = express();
const PORT = 3001;

app.use(bodyParser.json());

// Allow CORS from any origin (Chrome extension)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

app.post("/generate", async (req, res) => {
  const { prompt, model } = req.body;

  try {
    console.log("Proxy sending to DeepSeek:", prompt);
      const englishPrompt = 'Please respond in English only. User input:'+ prompt;
console.log(englishPrompt);
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "NodeFetch"
      },
      body: JSON.stringify({
        model: model || "deepseek-r1:8b",
        prompt: englishPrompt,
        stream: false
      })
    });

    console.log("DeepSeek status:", response.status, response.statusText);
    const data  =  await response.json();
    const outputText = data.output ?? data.response ?? data;
    console.log(outputText);
        res.json({ output: outputText });

  } catch (err) {
    console.error("Proxy fetch error:", err);
    res.status(500).send({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy server running at http://localhost:${PORT}`));
