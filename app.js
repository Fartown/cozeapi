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

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.set(CORS_HEADERS);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  console.info('Request Method:', req.path, req.method); 
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
  if (TokenConfig.access_token === "" || TokenConfig.expires_in === 0 || TokenConfig.expires_in < Date.now() / 1000) {
    TokenConfig = await getAccessToken();
  }
  console.log(TokenConfig.access_token);
  try {
    const data = req.body;
    console.info(JSON.stringify(data));
    const messages = data.messages;
    const model = data.model;
    const user = data.user !== undefined ? data.user : "apiuser";
    const chatHistory = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const message = messages[i];
      const role = message.role;
      const content = message.content;
      
      chatHistory.push({
        role: role,
        content: content,
        content_type: "text"
      });
    }

    const lastMessage = messages[messages.length - 1];
    const queryString = lastMessage.content;
    const stream = data.stream !== undefined ? data.stream : false;
    let requestBody;
    const bot_id = model && CONFIG.BOT_CONFIG[model] ? CONFIG.BOT_CONFIG[model] : CONFIG.DEFAULT_BOT_ID;

    requestBody = {
      query: queryString,
      stream: stream,
      conversation_id: "",
      user: user,
      bot_id: bot_id,
      chat_history: chatHistory
    };
    const coze_api_url = `https://${CONFIG.API_BASE}/open_api/v2/chat`;
    const resp = await fetch(coze_api_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TokenConfig.access_token}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      const stream = resp.body;
      let buffer = "";

      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
          let line = lines[i].trim();

          if (!line.startsWith("data:")) continue;
          line = line.slice(5).trim();
          let chunkObj;
          try {
            if (line.startsWith("{")) {
              chunkObj = JSON.parse(line);
            } else {
              continue;
            }
          } catch (error) {
            console.error("Error parsing chunk:", error);
            continue;
          }
          if (chunkObj.event === "message") {
            if (
              chunkObj.message.role === "assistant" &&
              chunkObj.message.type === "answer"
            ) {
              let chunkContent = chunkObj.message.content;

              if (chunkContent !== "") {
                const chunkId = `chatcmpl-${Date.now()}`;
                const chunkCreated = Math.floor(Date.now() / 1000);
                res.write(
                  "data: " +
                    JSON.stringify({
                      id: chunkId,
                      object: "chat.completion.chunk",
                      created: chunkCreated,
                      model: data.model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            content: chunkContent,
                          },
                          finish_reason: null,
                        },
                      ],
                    }) +
                    "\n\n"
                );
              }
            }
          } else if (chunkObj.event === "done") {
            const chunkId = `chatcmpl-${Date.now()}`;
            const chunkCreated = Math.floor(Date.now() / 1000);
            res.write(
              "data: " +
                JSON.stringify({
                  id: chunkId,
                  object: "chat.completion.chunk",
                  created: chunkCreated,
                  model: data.model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: "stop",
                    },
                  ],
                }) +
                "\n\n"
            );
            res.write("data: [DONE]\n\n");
            res.end();
          } else if (chunkObj.event === "ping") {
          } else if (chunkObj.event === "error") {
            let errorMsg = chunkObj.code + " " + chunkObj.message;

            if(chunkObj.error_information) {
              errorMsg = chunkObj.error_information.err_msg;
            }

            console.error('Error: ', errorMsg);

            res.write(
                    `data: ${JSON.stringify({ error: {
                        error: `Unexpected from Coze API`,
                        message: errorMsg
                      }
                    })}\n\n`
                );
            res.write("data: [DONE]\n\n");
            res.end();
          }
        }

        buffer = lines[lines.length - 1];
      });
    } else {
      resp
        .json()
        .then((data) => {
          if (data.code === 0 && data.msg === "success") {
            const messages = data.messages;
            const answerMessage = messages.find(
              (message) =>
                message.role === "assistant" && message.type === "answer"
            );

            if (answerMessage) {
              const result = answerMessage.content.trim();
              const usageData = {
                prompt_tokens: 100,
                completion_tokens: 10,
                total_tokens: 110,
              };
              const chunkId = `chatcmpl-${Date.now()}`;
              const chunkCreated = Math.floor(Date.now() / 1000);

              const formattedResponse = {
                id: chunkId,
                object: "chat.completion",
                created: chunkCreated,
                model: req.body.model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: result,
                    },
                    logprobs: null,
                    finish_reason: "stop",
                  },
                ],
                usage: usageData,
                system_fingerprint: "fp_2f57f81c11",
              };
              const jsonResponse = JSON.stringify(formattedResponse, null, 2);
              console.info(jsonResponse);
              
              res.set("Content-Type", "application/json");
              res.send(jsonResponse);
            } else {
              res.status(500).json({ error: "No answer message found." });
            }
          } else {
            console.error(data);
            res
              .status(500)
              .json({ error: {
                    error: `Unexpected from Coze API ${logid}`,
                    message: data.msg
                }
              });
          }
        })
        .catch((error) => {
          console.error("Error parsing JSON:", error);
          res.status(500).json({ error: "Error parsing JSON response." });
        });
    }
  } catch (error) {
    console.error("Error:", error);
  }
});

const server = app.listen(CONFIG.PORT, function () {
  let port = server.address().port
  console.info('Ready! Listening all IP, port: %s. Example: at http://localhost:%s', port, port)
});
