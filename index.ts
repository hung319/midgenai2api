// =================================================================================
//  Dự án: midgenai-bun-proxy
//  Môi trường: Bun (http://bun.sh)
//  Mô tả: OpenAI-compatible API cho MidgenAI (Hỗ trợ cả Chat & Image)
// =================================================================================

// --- [1. Cấu hình & Model Definitions] ---

const CONFIG = {
  PORT: process.env.PORT || 3000,
  API_KEY: process.env.API_KEY || "sk-midgen-bun-123", // Key bảo vệ API của bạn
  
  // Upstream Endpoints
  URL_IMAGE: "https://www.midgenai.com/api/image-generate",
  URL_CHAT: "https://www.midgenai.com/api/chat",
  
  HEADERS_COMMON: {
    "Origin": "https://www.midgenai.com",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  }
};

// Danh sách Model Chat (Từ snippet bạn cung cấp)
const CHAT_MODELS = [
  { id: "gemma-3-27b", name: "Gemma 3 27B" },
  { id: "gemma-3-12b", name: "Gemma 3 12B" },
  { id: "deepseek-r1", name: "DeepSeek R1" },
  { id: "deepseek-v3", name: "DeepSeek V3" },
  { id: "llama-4-maverick", name: "Llama 4" },
  { id: "llama-3-3-70b", name: "Llama 3.3 70B" },
  { id: "qwen-v3-32b", name: "Qwen V3 32B" },
  { id: "qwen-2-5-coder-32b", name: "Qwen 2.5 Coder 32B" }
];

// Danh sách Model Vẽ (Cũ)
const IMAGE_MODELS = [ "midgen-v1", "midgen-flux", "midgen-turbo" ];

// --- [2. Bun Server Entry] ---

console.log(`🚀 Server starting on port ${CONFIG.PORT}...`);

Bun.serve({
  port: CONFIG.CONFIG,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS Preflight
    if (req.method === "OPTIONS") return handleCors();

    // UI Dashboard
    if (url.pathname === "/") return handleUI();

    // API Routes
    if (url.pathname.startsWith("/v1/")) {
      // Auth Check
      const authHeader = req.headers.get("Authorization");
      if (CONFIG.API_KEY && (!authHeader || authHeader.replace("Bearer ", "") !== CONFIG.API_KEY)) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      if (url.pathname === "/v1/models") return handleModels();
      if (url.pathname === "/v1/chat/completions") return handleChatCompletions(req);
      if (url.pathname === "/v1/images/generations") return handleImageGenerations(req);
    }

    return jsonResponse({ error: "Not Found" }, 404);
  }
});

// --- [3. Logic Xử lý Chính] ---

/**
 * Xử lý request Chat/Completion
 * Đây là "Router" thông minh: Phân loại Chat vs Vẽ tranh
 */
async function handleChatCompletions(req: Request) {
  try {
    const body = await req.json();
    const modelId = body.model;

    // 3.1. Nếu model là vẽ tranh -> Chuyển sang logic tạo ảnh giả lập chat
    if (IMAGE_MODELS.includes(modelId) || modelId.startsWith("midgen")) {
      return await handleImageAsChat(body);
    }

    // 3.2. Nếu không phải vẽ -> Mặc định là Chat (Gọi API Chat Midgen)
    return await handleUpstreamChat(body);

  } catch (e: any) {
    console.error(e);
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * Xử lý Chat Thật (Gọi API Chat mới)
 */
async function handleUpstreamChat(body: any) {
  const messages = body.messages || [];
  // Lấy tin nhắn cuối cùng hoặc ghép lịch sử (Midgen có vẻ chỉ nhận context ngắn hoặc last msg, tùy logic server họ)
  // Ở đây ta gửi toàn bộ messages dạng array nếu API hỗ trợ, 
  // nhưng theo curl mẫu: `messages` là array objects. Ta gửi nguyên trạng.
  
  const payload = {
    model: body.model || "deepseek-r1",
    messages: messages // Forward nguyên array messages
  };

  console.log(`[Chat] Requesting ${payload.model}...`);

  const response = await fetch(CONFIG.URL_CHAT, {
    method: "POST",
    headers: {
      ...CONFIG.HEADERS_COMMON,
      "Content-Type": "application/json",
      "Referer": "https://www.midgenai.com/chat-bots" // Quan trọng: Referer cho chat
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Upstream Error (${response.status}): ${txt}`);
  }

  const data = await response.json(); 
  // Response mẫu: {"response":"Hello there!..."}

  // Format về chuẩn OpenAI
  const content = data.response || "";
  
  return jsonResponse({
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: payload.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content
      },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } // Fake usage
  });
}

/**
 * Xử lý Vẽ tranh nhưng trả về format Chat (Cho client chat vẽ hình)
 */
async function handleImageAsChat(body: any) {
  const lastMsg = body.messages[body.messages.length - 1];
  const prompt = lastMsg?.content || "A cat";
  
  // Logic tạo ảnh (giản lược từ file cũ)
  const imgBase64 = await generateImage(prompt, "1:1"); // Mặc định 1:1
  
  const markdown = `![Generated Image](data:image/jpeg;base64,${imgBase64})`;

  return jsonResponse({
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: markdown },
      finish_reason: "stop"
    }]
  });
}

/**
 * API tạo ảnh chuẩn (/v1/images/generations)
 */
async function handleImageGenerations(req: Request) {
  try {
    const body = await req.json();
    const b64 = await generateImage(body.prompt, "1:1"); // Cần parse size -> aspect ratio
    return jsonResponse({
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: b64 }]
    });
  } catch(e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
}

/**
 * Helper: Gọi API tạo ảnh gốc
 */
async function generateImage(prompt: string, aspectRatio: string) {
  const payload = {
    prompt: prompt,
    negative_prompt: "",
    aspect_ratio: aspectRatio,
    steps: 100,
    seed: 0
  };

  const res = await fetch(CONFIG.URL_IMAGE, {
    method: "POST",
    headers: {
      ...CONFIG.HEADERS_COMMON,
      "Content-Type": "application/json",
      "Referer": "https://www.midgenai.com/text-to-image"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`Image Gen Failed: ${res.status}`);
  const data = await res.json();
  if (!data.image) throw new Error("No image returned");
  return data.image;
}

function handleModels() {
  // Gộp cả model chat và model ảnh
  const allModels = [
    ...CHAT_MODELS.map(m => ({ id: m.id, object: "model", created: Date.now(), owned_by: "midgen-chat" })),
    ...IMAGE_MODELS.map(m => ({ id: m, object: "model", created: Date.now(), owned_by: "midgen-image" }))
  ];
  return jsonResponse({ object: "list", data: allModels });
}

// --- [4. Utilities & UI] ---

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

function handleUI() {
  // UI đơn giản để test chọn model
  const html = `
  <!DOCTYPE html>
  <html>
  <head><title>Midgen Bun Proxy</title><style>body{font-family:sans-serif;padding:20px;background:#111;color:#fff} select,input,button{padding:8px;margin:5px;width:100%} .box{background:#222;padding:15px;border-radius:8px;margin-bottom:10px}</style></head>
  <body>
    <h2>⚡ MidgenAI Bun Proxy</h2>
    <div class="box">
      <label>API Key</label><input value="${CONFIG.API_KEY}" readonly style="background:#333;color:#aaa;border:none">
      <label>Model</label>
      <select id="model">
        <optgroup label="Chat Models">
          ${CHAT_MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
        </optgroup>
        <optgroup label="Image Models">
          ${IMAGE_MODELS.map(m => `<option value="${m}">${m}</option>`).join('')}
        </optgroup>
      </select>
      <label>Message / Prompt</label>
      <input id="input" placeholder="Type here... (e.g. 'Hello' or 'Draw a cat')">
      <button onclick="send()">Send</button>
    </div>
    <div id="output" class="box" style="white-space:pre-wrap;min-height:100px"></div>
    <script>
      async function send() {
        const out = document.getElementById('output');
        out.innerText = "Loading...";
        const model = document.getElementById('model').value;
        const content = document.getElementById('input').value;
        
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${CONFIG.API_KEY}' },
          body: JSON.stringify({ model, messages: [{role:'user', content}] })
        });
        const data = await res.json();
        if(data.choices) {
            out.innerText = data.choices[0].message.content;
        } else {
            out.innerText = JSON.stringify(data, null, 2);
        }
      }
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
