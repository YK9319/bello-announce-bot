const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store pending announcements waiting for approval
const pending = {};

console.log("Bello Announce Bot started...");

// Listen for messages in the group
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const fromId = msg.from.id;

  // Ignore bot's own messages
  if (msg.from.is_bot) return;

  // Command: /generate <merchant info>
  if (text.startsWith("/generate ")) {
    const merchantInfo = text.replace("/generate ", "").trim();
    await handleGenerate(chatId, fromId, merchantInfo, "new_merchant");
    return;
  }

  // Command: /daily - generate a daily reminder (no merchant info needed)
  if (text === "/daily") {
    await handleGenerate(chatId, fromId, null, "daily");
    return;
  }

  // Command: /help
  if (text === "/help" || text === "/start") {
    await bot.sendMessage(
      chatId,
      `🍊 *Bello Announce Bot*\n\n` +
        `用法：\n` +
        `/generate <商家资讯> — 生成新商家公告\n` +
        `例：/generate 新商家：Kedai Kopi Uncle Lim，地点：SS15 Subang\n\n` +
        `/daily — 生成今日用户提醒\n\n` +
        `生成后你可以选择 ✅ 批准或 ✏️ 修改内容`,
      { parse_mode: "Markdown" }
    );
    return;
  }
});

// Handle approve/reject callbacks
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (data.startsWith("approve_")) {
    const id = data.replace("approve_", "");
    const ann = pending[id];
    if (!ann) {
      await bot.answerCallbackQuery(query.id, { text: "已过期" });
      return;
    }

    // Format final approved content
    const finalText =
      `✅ *已批准 — 复制到 CMS*\n\n` +
      `*[EN]*\n📌 ${ann.en.title}\n${ann.en.body}\n\n` +
      `*[BM]*\n📌 ${ann.bm.title}\n${ann.bm.body}\n\n` +
      `*[中文]*\n📌 ${ann.zh.title}\n${ann.zh.body}`;

    await bot.editMessageText(finalText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 重新生成", callback_data: `regen_${id}` }],
        ],
      },
    });

    await bot.answerCallbackQuery(query.id, { text: "✅ 已批准！" });
    delete pending[id];
  }

  if (data.startsWith("reject_")) {
    const id = data.replace("reject_", "");
    const ann = pending[id];
    if (!ann) {
      await bot.answerCallbackQuery(query.id, { text: "已过期" });
      return;
    }

    await bot.editMessageText(
      `❌ 已拒绝。发送 /generate <商家资讯> 重新生成`,
      {
        chat_id: chatId,
        message_id: messageId,
      }
    );

    await bot.answerCallbackQuery(query.id, { text: "已拒绝" });
    delete pending[id];
  }

  if (data.startsWith("regen_")) {
    const id = data.replace("regen_", "");
    // Re-trigger with same info stored
    await bot.answerCallbackQuery(query.id, { text: "重新生成中..." });
    await bot.sendMessage(chatId, "🔄 重新生成中，请稍等...");
    // User needs to run /generate again with new info
  }
});

async function handleGenerate(chatId, fromId, merchantInfo, type) {
  const loadingMsg = await bot.sendMessage(chatId, "⏳ AI 生成中，请稍等...");

  try {
    const result = await generateAnnouncement(merchantInfo, type);
    const id = `${fromId}_${Date.now()}`;
    pending[id] = result;

    const previewText =
      `📣 *文案草稿已生成*\n\n` +
      `*[EN]*\n📌 *${result.en.title}*\n${result.en.body}\n\n` +
      `*[BM]*\n📌 *${result.bm.title}*\n${result.bm.body}\n\n` +
      `*[中文]*\n📌 *${result.zh.title}*\n${result.zh.body}\n\n` +
      `─────────────\n请审核以上内容：`;

    await bot.editMessageText(previewText, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ 批准发布", callback_data: `approve_${id}` },
            { text: "❌ 拒绝", callback_data: `reject_${id}` },
          ],
        ],
      },
    });
  } catch (err) {
    console.error("Generate error:", err);
    await bot.editMessageText(`❌ 生成失败：${err.message}`, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
    });
  }
}

async function generateAnnouncement(merchantInfo, type) {
  let prompt;

  if (type === "new_merchant") {
    prompt = `You are a content creator for Bello App — Malaysia's first treasure-hunting app where users scan QR codes at merchant locations to collect Event Diamonds (ED) and redeem rewards.

A NEW MERCHANT has joined Bello App: ${merchantInfo}

Generate a CMS announcement in THREE languages to notify users about this new merchant.

Each version needs:
- title: short punchy title (max 8 words)  
- body: 1-2 sentences, exciting, encourage users to visit and scan the QR code to collect Event Diamonds

Rules:
- Malaysian casual tone (use "lah", "weh", "jom" in BM/CN versions naturally)
- Mention scanning QR code and collecting Event Diamonds
- Make it feel exciting and worth visiting
- No hashtags

Respond ONLY with valid JSON, no markdown fences:
{"en":{"title":"...","body":"..."},"bm":{"title":"...","body":"..."},"zh":{"title":"...","body":"..."}}`;
  } else {
    const themes = [
      "Remind users to scan QR codes at merchants to collect Event Diamonds",
      "Encourage users to redeem their Event Diamonds in the Diamond Mall",
      "Remind users to explore new merchants on the Bello App map",
      "Encourage users to keep their daily streak going",
      "Remind users about Diamond Rain — diamonds falling on the map to collect",
      "Encourage users to spend their Bello Points (BP) on rewards",
      "Remind users to collect hollow diamond bonuses from merchants",
    ];
    const theme = themes[Math.floor(Math.random() * themes.length)];

    prompt = `You are a content creator for Bello App — Malaysia's first treasure-hunting app where users scan QR codes at merchant locations to collect Event Diamonds (ED) and redeem rewards in the Diamond Mall.

Generate a daily user reminder CMS announcement.
Theme: ${theme}

Create ONE announcement in THREE languages:
1. English
2. Bahasa Malaysia
3. Chinese (Simplified, casual Malaysian style)

Each version needs:
- title: short punchy title (max 8 words)
- body: 1-2 sentences, engaging, relevant to theme

Rules:
- Malaysian casual tone (use "lah", "weh", "jom" in BM/CN naturally)
- No hashtags, no excessive emoji
- Keep body under 50 words per language
- "Bello Points" not "BP" in formal copy

Respond ONLY with valid JSON, no markdown fences:
{"en":{"title":"...","body":"..."},"bm":{"title":"...","body":"..."},"zh":{"title":"...","body":"..."}}`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.map((b) => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}
