import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import getAccessToken from "./token.js";
dotenv.config();

// 配置常量
const CONFIG = {
  API_BASE: process.env.COZE_API_BASE || "api.coze.com",
  DEFAULT_BOT_ID: process.env.BOT_ID || "",
  BOT_CONFIG: process.env.BOT_CONFIG ? JSON.parse(process.env.BOT_CONFIG) : {},
  PORT: process.env.PORT || 3000
};

// CORS headers配置
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization",
  "Access-Control-Max-Age": "86400",
};

// Token管理
let TokenConfig = {
  access_token: "",
  expires_in: 0,
};

// 处理流式响应的函数
function handleStreamResponse(stream, res, model) {
  res.setHeader("Content-Type", "text/event-stream");
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    
    // ... rest of streaming logic ...
  });
}

// 处理非流式响应的函数
async function handleNonStreamResponse(data, req, res) {
  if (data.code === 0 && data.msg === "success") {
    const answerMessage = data.messages.find(msg => 
      msg.role === "assistant" && msg.type === "answer"
    );
    
    if (!answerMessage) {
      throw new Error("No answer message found.");
    }

    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.body.model,
      choices: [{
        index: 0,
        message: { 
          role: "assistant", 
          content: answerMessage.content.trim() 
        },
        logprobs: null,
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      system_fingerprint: "fp_2f57f81c11",
    };

    res.set("Content-Type", "application/json");
    res.send(JSON.stringify(response, null, 2));
  } else {
    throw new Error(data.msg || "Unexpected response from Coze API.");
  }
}

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.set(CORS_HEADERS);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  console.log('Request Method:', req.method); 
  console.log('Request Path:', req.path);
  next();
});
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>COZE2OPENAI</title>
      </head>
      <body>
        <h1>Coze2OpenAI</h1>
        <p>Congratulations! Your project has been successfully deployed.</p>
      </body>
    </html>
  `);
});

app.post("/v1/chat/completions", async (req, res) => {
  // 检测 是否TokenConfig 以及 token 是否过期 如果没有或者过期 则重新获取
  if (!TokenConfig.access_token || TokenConfig.expires_in <= Date.now() / 1000) {
    TokenConfig = await getAccessToken();
  }
  
  const token = TokenConfig.access_token;
  if (!token) {
    return res.status(401).json({ code: 401, errmsg: "Unauthorized." });
  }

  try {
    const { messages, model, user = "apiuser", stream = false } = req.body;
    const chatHistory = messages.slice(0, -1).map(({ role, content }) => ({
      role,
      content,
      content_type: "text"
    }));

    const queryString = messages[messages.length - 1].content;
    const bot_id = model && CONFIG.BOT_CONFIG[model] ? CONFIG.BOT_CONFIG[model] : CONFIG.DEFAULT_BOT_ID;

    const requestBody = {
      query: queryString,
      stream,
      conversation_id: "",
      user,
      bot_id,
      chat_history: chatHistory
    };

    const coze_api_url = `https://${CONFIG.API_BASE}/open_api/v2/chat`;
    const resp = await fetch(coze_api_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (stream) {
      // Stream handling logic
      handleStreamResponse(resp.body, res, model);
    } else {
      // Handle non-streaming response
      const data = await resp.json();
      await handleNonStreamResponse(data, req, res);
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

const server = app.listen(CONFIG.PORT, function () {
  let port = server.address().port
  console.log('Ready! Listening all IP, port: %s. Example: at http://localhost:%s', port, port)
});
