// server.js (CommonJS version)
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

/** =========================
 *  LOGGING UTILITIES
 *  ========================= */

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const formatTimestamp = () => {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
};

const logRequest = (req) => {
  console.log(`${colors.cyan}[${formatTimestamp()}] INCOMING REQUEST${colors.reset}`);
  console.log(`${colors.blue}Method:${colors.reset} ${req.method}`);
  console.log(`${colors.blue}URL:${colors.reset} ${req.url}`);
  console.log(`${colors.blue}Headers:${colors.reset} ${JSON.stringify(req.headers, null, 2)}`);

  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`${colors.blue}Body:${colors.reset}`);
    const bodyStr = JSON.stringify(req.body, null, 2);
    if (bodyStr.length > 1000) {
      console.log(bodyStr.substring(0, 1000) + '... (truncated)');
    } else {
      console.log(bodyStr);
    }
  }
  console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}\n`);
};

const logResponse = (status, data, duration) => {
  console.log(`${colors.green}[${formatTimestamp()}] OUTGOING RESPONSE${colors.reset}`);
  console.log(`${colors.yellow}Status:${colors.reset} ${status}`);
  console.log(`${colors.yellow}Duration:${colors.reset} ${duration}ms`);

  if (data) {
    console.log(`${colors.yellow}Response Data:${colors.reset}`);
    const dataStr = JSON.stringify(data, null, 2);
    if (dataStr.length > 1000) {
      console.log(dataStr.substring(0, 1000) + '... (truncated)');
    } else {
      console.log(dataStr);
    }
  }
  console.log(`${colors.green}${'='.repeat(50)}${colors.reset}\n`);
};

const logError = (error, context = '') => {
  console.log(`${colors.red}[${formatTimestamp()}] ERROR${context ? ` (${context})` : ''}${colors.reset}`);
  console.log(`${colors.red}Error:${colors.reset} ${error.message || error}`);
  if (error.stack) {
    console.log(`${colors.red}Stack:${colors.reset} ${error.stack}`);
  }
  console.log(`${colors.red}${'='.repeat(50)}${colors.reset}\n`);
};

const logLLMRequest = (url, body) => {
  console.log(`${colors.magenta}[${formatTimestamp()}] LLM REQUEST${colors.reset}`);
  console.log(`${colors.white}Target URL:${colors.reset} ${url}`);
  console.log(`${colors.white}Payload:${colors.reset}`);
  const bodyStr = JSON.stringify(body, null, 2);
  if (bodyStr.length > 800) {
    console.log(bodyStr.substring(0, 800) + '... (truncated)');
  } else {
    console.log(bodyStr);
  }
  console.log(`${colors.magenta}${'='.repeat(50)}${colors.reset}\n`);
};

/** =========================
 *  MIDDLEWARE FOR REQUEST LOGGING
 *  ========================= */
app.use((req, res, next) => {
  logRequest(req);
  req.startTime = Date.now();

  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - req.startTime;
    logResponse(res.statusCode, data, duration);
    return originalJson.call(this, data);
  };

  next();
});

/** =========================
 *  TARGET BACKEND SETTINGS
 *  ========================= */

const TARGET_URL = "http://localhost:11434/api/chat";
const toBackendBody = (body) => ({
  model: body.model || "gpt-oss:20b",
  messages: body.messages,
  stream: false,
});

/** =========================
 *  ENDPOINTS
 *  ========================= */

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    target: TARGET_URL
  });
});

app.get('/status', (req, res) => {
  res.json({
    service: 'LLM Proxy Server',
    status: 'running',
    target_url: TARGET_URL,
    port: 3000,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.post("/api/chat", async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.body.messages || !Array.isArray(req.body.messages)) {
      const error = { error: "Invalid request: 'messages' array is required" };
      logError(new Error(error.error), "Validation");
      return res.status(400).json(error);
    }

    const backendBody = toBackendBody(req.body);
    logLLMRequest(TARGET_URL, backendBody);

    const resp = await fetch(TARGET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "LLM-Proxy/1.0"
      },
      body: JSON.stringify(backendBody),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      const error = new Error(`LLM API returned ${resp.status}: ${errorText}`);
      logError(error, "LLM Response");
      return res.status(resp.status).json({
        error: "LLM API error",
        status: resp.status,
        details: errorText
      });
    }

    const data = await resp.json();

    console.log(`${colors.green}[${formatTimestamp()}] LLM RESPONSE RECEIVED${colors.reset}`);
    console.log(`${colors.white}Duration:${colors.reset} ${Date.now() - startTime}ms`);
    console.log(`${colors.white}Response size:${colors.reset} ${JSON.stringify(data).length} characters`);
    console.log(`${colors.green}${'='.repeat(50)}${colors.reset}\n`);

    res.json(data);

  } catch (error) {
    logError(error, "Proxy");

    let statusCode = 500;
    let errorResponse = { error: "Proxy failed", details: String(error) };

    if (error.code === 'ECONNREFUSED') {
      statusCode = 503;
      errorResponse = {
        error: "LLM service unavailable",
        details: "Could not connect to local LLM server",
        target: TARGET_URL
      };
    }

    res.status(statusCode).json(errorResponse);
  }
});

app.use((err, req, res, next) => {
  logError(err, "Express Error Handler");
  res.status(500).json({
    error: "Internal server error",
    details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.use((req, res) => {
  console.log(`${colors.yellow}[${formatTimestamp()}] 404 - Route not found: ${req.method} ${req.url}${colors.reset}\n`);
  res.status(404).json({ error: "Route not found" });
});

/** =========================
 *  SERVER STARTUP
 *  ========================= */
const PORT = process.env.PORT || 3000;

// Add error handling for server startup
const server = app.listen(PORT, () => {
  console.log(`${colors.bright}${colors.green}🚀 LLM Proxy Server Started${colors.reset}`);
  console.log(`${colors.green}Port:${colors.reset} ${PORT}`);
  console.log(`${colors.green}Proxy URL:${colors.reset} http://localhost:${PORT}/api/chat`);
  console.log(`${colors.green}Health Check:${colors.reset} http://localhost:${PORT}/health`);
  console.log(`${colors.green}Status:${colors.reset} http://localhost:${PORT}/status`);
  console.log(`${colors.green}Target LLM:${colors.reset} ${TARGET_URL}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}\n`);
  console.log(`${colors.cyan}Waiting for requests...${colors.reset}\n`);
});

server.on('error', (error) => {
  console.error(`${colors.red}Server startup error:${colors.reset}`, error);
  if (error.code === 'EADDRINUSE') {
    console.error(`${colors.red}Port ${PORT} is already in use. Try a different port.${colors.reset}`);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Received SIGINT. Gracefully shutting down...${colors.reset}`);
  server.close(() => {
    console.log(`${colors.yellow}Server closed.${colors.reset}`);
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log(`\n${colors.yellow}Received SIGTERM. Gracefully shutting down...${colors.reset}`);
  server.close(() => {
    console.log(`${colors.yellow}Server closed.${colors.reset}`);
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`${colors.red}Uncaught Exception:${colors.reset}`, error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`${colors.red}Unhandled Rejection at:${colors.reset}`, promise, `${colors.red}reason:${colors.reset}`, reason);
  process.exit(1);
});