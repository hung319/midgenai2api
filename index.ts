// =================================================================================
//  Project: midgenai-bun-api (Pure Backend)
//  Type: Headless Proxy / OpenAI-Compatible API
//  Runtime: Bun v1.x
// =================================================================================

const CONFIG = {
  PORT: process.env.PORT || 3000,
  API_KEY: process.env.API_KEY || "sk-midgen-bun-123", // Client phải gửi key này
  
  URL_IMAGE: "https://www.midgenai.com/api/image-generate",
  URL_CHAT: "https://www.midgenai.com/api/chat",
  
  HEADERS_COMMON: {
    "Origin": "https://www.midgenai.com",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  }
};

// --- Model Definitions ---
const CHAT_MODELS = [
  "gemma-3-27b", "gemma-3-12b", "deepseek-r1", "deepseek-v3", 
  "llama-4-maverick", "llama-3-3-70b", "qwen-v3-32b", "qwen-2-5-coder-32b"
];

const IMAGE_MODELS = [ "midgen-v1", "midgen-flux", "midgen-turbo" ];

// --- Server Entry ---
console.log(`🚀 Pure API Server running on port ${CONFIG.PORT}`);

Bun.serve({
  port: CONFIG.PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // 1. CORS Preflight (Cho phép các Web Client gọi vào)
    if (req.method === "OPTIONS") return handleCors();

    // 2. Health Check (Root path)
    if (url.pathname === "/") {
      return jsonResponse({ 
        status: "ok", 
        service: "midgen-openai-proxy", 
        time: new Date().toISOString() 
      });
    }

    // 3. API Routes (Bảo vệ bằng Key)
    if (url.pathname.startsWith("/v1/")) {
      // Auth Check
      const authHeader = req.headers.get("Authorization");
      if (CONFIG.API_KEY && (!authHeader || authHeader.replace("Bearer ", "") !== CONFIG.API_KEY)) {
        return jsonResponse({ error: { message: "Invalid API Key", type: "auth_error" } }, 401);
      }

      try {
        if (url.pathname === "/v1/models") return handleModels();
        if (url.pathname === "/v1/chat/completions") return await handleChatCompletions(req);
        if (url.pathname === "/v1/images/generations") return await handleImageGenerations(req);
      } catch (e: any) {
        console.error(`[Error] ${url.pathname}:`, e.message);
        return jsonResponse({ error: { message: e.message, type: "server_error" } }, 500);
      }
    }

    return jsonResponse({ error: { message: "Not Found" } }, 404);
  }
});

// --- Handlers ---

async function handleChatCompletions(req: Request) {
  const body = await req.json();
  const modelId = body.model;

  // Routing: Nếu model thuộc nhóm vẽ -> Gọi logic vẽ giả lập chat
  if (IMAGE_MODELS.includes(modelId) || modelId.startsWith("midgen")) {
    return await handleImageAsChat(body);
  }

  // Mặc định: Gọi API Chat
  return await handleUpstreamChat(body);
}

async function handleUpstreamChat(body: any) {
  const payload = {
    model: body.model || "deepseek-r1",
    messages: body.messages
  };

  const response = await fetch(CONFIG.URL_CHAT, {
    method: "POST",
    headers: { ...CONFIG.HEADERS_COMMON, "Content-Type": "application/json", "Referer": "https://www.midgenai.com/chat-bots" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`Upstream Chat Error: ${response.status}`);
  
  const data = await response.json();
  const content = data.response || "";

  return jsonResponse({
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: payload.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: content },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

async function handleImageAsChat(body: any) {
  const lastMsg = body.messages[body.messages.length - 1];
  const prompt = lastMsg?.content || "Abstract art";
  
  const b64 = await generateImage(prompt, "1:1");
  const markdown = `![Generated Image](data:image/jpeg;base64,${b64})`;

  return jsonResponse({
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content: markdown }, finish_reason: "stop" }]
  });
}

async function handleImageGenerations(req: Request) {
  const body = await req.json();
  // Mapping size OpenAI -> Aspect Ratio Midgen
  let ar = "1:1";
  if (body.size === "1024x1792") ar = "9:16";
  if (body.size === "1792x1024") ar = "16:9";

  const b64 = await generateImage(body.prompt, ar);
  return jsonResponse({
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: b64 }]
  });
}

async function generateImage(prompt: string, aspectRatio: string) {
  const response = await fetch(CONFIG.URL_IMAGE, {
    method: "POST",
    headers: { ...CONFIG.HEADERS_COMMON, "Content-Type": "application/json", "Referer": "https://www.midgenai.com/text-to-image" },
    body: JSON.stringify({
      prompt, negative_prompt: "", aspect_ratio: aspectRatio, steps: 100, seed: 0
    })
  });

  if (!response.ok) throw new Error(`Upstream Image Error: ${response.status}`);
  const data = await response.json();
  if (!data.image) throw new Error("No image data received from upstream");
  return data.image;
}

function handleModels() {
  const list = [
    ...CHAT_MODELS.map(id => ({ id, object: "model", owned_by: "midgen-chat" })),
    ...IMAGE_MODELS.map(id => ({ id, object: "model", owned_by: "midgen-image" }))
  ];
  return jsonResponse({ object: "list", data: list });
}

// --- Utilities ---

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Headers": "Content-Type, Authorization" 
    }
  });
}

function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
