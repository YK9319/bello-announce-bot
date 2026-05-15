const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const { publishToCMS } = require("./cms-publisher");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const pending = {};
const weeklySessions = {};

console.log("Bello Announce Bot v2 started...");

const THEMES = [
  { key: "qr_hunt",        label: "QR 扫码打卡" },
  { key: "diamonds",       label: "收集 Event Diamonds" },
  { key: "redeem",         label: "兑换奖励" },
  { key: "explore",        label: "探索商家" },
  { key: "diamond_rain",   label: "玩钻石雨" },
  { key: "spend_bp",       label: "消费 Bello Points" },
  { key: "hollow_diamond", label: "收集空头钻石奖励" },
  { key: "new_merchant",   label: "新商家上线" },
  { key: "offline_spend",  label: "线下消费商家可获得钻石奖励" },
];

// ─── COMMANDS ────────────────────────────────────────────────────────────────

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const fromId = msg.from.id;
  if (msg.from.is_bot) return;

  if (text.startsWith("/generate ")) {
    await handleGenerate(chatId, fromId, text.replace("/generate ", "").trim(), "new_merchant");
    return;
  }
  if (text === "/daily") {
    await handleGenerate(chatId, fromId, null, "daily");
    return;
  }
  if (text === "/weekly") {
    await handleWeekly(chatId, fromId);
    return;
  }
  if (text === "/help" || text === "/start") {
    await bot.sendMessage(chatId,
      `🍊 *Bello Announce Bot v2*\n\n` +
      `/weekly — 批量生成 7 天公告，审核后自动发布到 CMS\n` +
      `/generate <商家资讯> — 新商家入驻公告\n` +
      `/daily — 生成单日用户提醒`,
      { parse_mode: "Markdown" }
    );
    return;
  }
});

// ─── WEEKLY ──────────────────────────────────────────────────────────────────

async function handleWeekly(chatId, fromId) {
  const sessionKey = `${chatId}_${fromId}`;
  const now = new Date();
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push({ label: formatDate(d), date: d });
  }
  weeklySessions[sessionKey] = { days, approved: [] };

  await bot.sendMessage(chatId,
    `📅 *7 天公告批量生成*\n\n` +
    days.map((d, i) => `Day ${i + 1}：${d.label}`).join("\n") +
    `\n\n每天发送时间：*上午 10:00*\n\n审核完成后将自动发布到 Bello CMS 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "🚀 开始生成 Day 1", callback_data: `wgen_${sessionKey}_0` }
      ]]},
    }
  );
}

async function generateWeeklyDay(chatId, sessionKey, dayIndex) {
  const session = weeklySessions[sessionKey];
  if (!session) return;
  const theme = THEMES[dayIndex % THEMES.length];
  const dayInfo = session.days[dayIndex];
  const loadingMsg = await bot.sendMessage(chatId, `⏳ 生成 Day ${dayIndex + 1}／7（${dayInfo.label} · ${theme.label}）...`);

  try {
    const result = await generateAnnouncement(null, "daily", theme.key, theme.label);
    const id = `w_${sessionKey}_${dayIndex}_${Date.now()}`;
    pending[id] = { ...result, dayIndex, dayLabel: dayInfo.label, date: dayInfo.date, theme: theme.label, sessionKey, chatId };

    await bot.editMessageText(
      `📣 *Day ${dayIndex + 1}／7 — ${dayInfo.label}*\n主题：${theme.label}\n\n` +
      `*[EN]*\n📌 ${result.en.title}\n${result.en.body}\n\n` +
      `*[BM]*\n📌 ${result.bm.title}\n${result.bm.body}\n\n` +
      `*[中文]*\n📌 ${result.zh.title}\n${result.zh.body}\n\n` +
      `─────────────\n审核此条：`,
      {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "✅ 批准", callback_data: `wapprove_${id}` },
          { text: "🔄 重新生成", callback_data: `wregen_${id}` },
        ]]},
      }
    );
  } catch (err) {
    console.error(err);
    await bot.editMessageText(`❌ Day ${dayIndex + 1} 生成失败：${err.message}`, {
      chat_id: chatId, message_id: loadingMsg.message_id,
    });
  }
}

// ─── CALLBACKS ───────────────────────────────────────────────────────────────

bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // Weekly: generate day
  if (data.startsWith("wgen_")) {
    const parts = data.replace("wgen_", "").split("_");
    const dayIndex = parseInt(parts[parts.length - 1]);
    const sessionKey = parts.slice(0, -1).join("_");
    await bot.answerCallbackQuery(query.id);
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    await generateWeeklyDay(chatId, sessionKey, dayIndex);
    return;
  }

  // Weekly: approve
  if (data.startsWith("wapprove_")) {
    const id = data.replace("wapprove_", "");
    const ann = pending[id];
    if (!ann) { await bot.answerCallbackQuery(query.id, { text: "已过期" }); return; }

    const session = weeklySessions[ann.sessionKey];
    session.approved.push(ann);
    session.approved.sort((a, b) => a.dayIndex - b.dayIndex);
    delete pending[id];

    const nextDay = ann.dayIndex + 1;
    const isLast = nextDay >= 7;

    await bot.editMessageText(
      `✅ *Day ${ann.dayIndex + 1} 已批准* — ${ann.dayLabel} · ${ann.theme}`,
      {
        chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          isLast
            ? { text: "🚀 确认发布全部到 CMS", callback_data: `wpublish_${ann.sessionKey}` }
            : { text: `➡️ 生成 Day ${nextDay + 1}`, callback_data: `wgen_${ann.sessionKey}_${nextDay}` }
        ]]},
      }
    );
    await bot.answerCallbackQuery(query.id, { text: `Day ${ann.dayIndex + 1} 已批准 ✅` });
    return;
  }

  // Weekly: regen
  if (data.startsWith("wregen_")) {
    const id = data.replace("wregen_", "");
    const ann = pending[id];
    if (!ann) { await bot.answerCallbackQuery(query.id, { text: "已过期" }); return; }
    await bot.answerCallbackQuery(query.id, { text: "重新生成中..." });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    delete pending[id];
    await generateWeeklyDay(chatId, ann.sessionKey, ann.dayIndex);
    return;
  }

  // Weekly: publish to CMS
  if (data.startsWith("wpublish_")) {
    const sessionKey = data.replace("wpublish_", "");
    const session = weeklySessions[sessionKey];
    if (!session) { await bot.answerCallbackQuery(query.id, { text: "已过期" }); return; }

    await bot.answerCallbackQuery(query.id, { text: "开始发布..." });
    await bot.editMessageText(
      `⏳ *正在自动发布 ${session.approved.length} 条公告到 CMS...*\n\n请稍等，完成后会通知你。`,
      { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
    );

    // Run Playwright in background
    publishToCMS(session.approved)
      .then(async (results) => {
        const success = results.filter(r => r.status === "success").length;
        const failed = results.filter(r => r.status === "failed");

        let summary = `🎉 *CMS 发布完成！*\n\n✅ 成功：${success} 条\n`;
        if (failed.length) {
          summary += `❌ 失败：${failed.length} 条\n`;
          failed.forEach(f => { summary += `  • ${f.day}：${f.error}\n`; });
          summary += `\n失败的条目请手动补填。`;
        } else {
          summary += `\n7 天公告已全部排程，无需任何手动操作 🍊`;
        }

        await bot.sendMessage(chatId, summary, { parse_mode: "Markdown" });
        delete weeklySessions[sessionKey];
      })
      .catch(async (err) => {
        await bot.sendMessage(chatId,
          `❌ *发布失败*\n\n错误：${err.message}\n\n请检查 CMS 账号密码是否正确（Railway Variables：CMS_USERNAME / CMS_PASSWORD）`,
          { parse_mode: "Markdown" }
        );
      });
    return;
  }

  // Single: approve
  if (data.startsWith("approve_")) {
    const id = data.replace("approve_", "");
    const ann = pending[id];
    if (!ann) { await bot.answerCallbackQuery(query.id, { text: "已过期" }); return; }
    await bot.editMessageText(
      `✅ *已批准 — 复制到 CMS*\n\n` +
      `*[EN]*\n📌 ${ann.en.title}\n${ann.en.body}\n\n` +
      `*[BM]*\n📌 ${ann.bm.title}\n${ann.bm.body}\n\n` +
      `*[中文]*\n📌 ${ann.zh.title}\n${ann.zh.body}`,
      { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
    );
    await bot.answerCallbackQuery(query.id, { text: "✅ 已批准！" });
    delete pending[id];
    return;
  }

  // Single: reject
  if (data.startsWith("reject_")) {
    const id = data.replace("reject_", "");
    await bot.editMessageText(`❌ 已拒绝。发送 /daily 或 /generate 重新生成`, { chat_id: chatId, message_id: messageId });
    await bot.answerCallbackQuery(query.id, { text: "已拒绝" });
    delete pending[id];
    return;
  }
});

// ─── SINGLE GENERATE ─────────────────────────────────────────────────────────

async function handleGenerate(chatId, fromId, merchantInfo, type) {
  const loadingMsg = await bot.sendMessage(chatId, "⏳ AI 生成中，请稍等...");
  try {
    const result = await generateAnnouncement(merchantInfo, type);
    const id = `single_${fromId}_${Date.now()}`;
    pending[id] = result;
    await bot.editMessageText(
      `📣 *文案草稿*\n\n` +
      `*[EN]*\n📌 ${result.en.title}\n${result.en.body}\n\n` +
      `*[BM]*\n📌 ${result.bm.title}\n${result.bm.body}\n\n` +
      `*[中文]*\n📌 ${result.zh.title}\n${result.zh.body}\n\n─────────────\n请审核：`,
      {
        chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "✅ 批准", callback_data: `approve_${id}` },
          { text: "❌ 拒绝", callback_data: `reject_${id}` },
        ]]},
      }
    );
  } catch (err) {
    await bot.editMessageText(`❌ 生成失败：${err.message}`, { chat_id: chatId, message_id: loadingMsg.message_id });
  }
}

// ─── AI ──────────────────────────────────────────────────────────────────────

async function generateAnnouncement(merchantInfo, type, themeKey, themeLabel) {
  const themeDescriptions = {
    qr_hunt:        "Remind users to scan QR codes at merchants to collect Event Diamonds",
    diamonds:       "Encourage users to collect more Event Diamonds by visiting merchants",
    redeem:         "Encourage users to redeem their Event Diamonds in the Diamond Mall",
    explore:        "Encourage users to explore new merchants on the Bello App map",
    diamond_rain:   "Remind users to play Diamond Rain — diamonds fall on the map, tap fast to collect them",
    spend_bp:       "Encourage users to spend their Bello Points on exciting rewards",
    hollow_diamond: "Remind users to collect hollow diamond bonuses available at merchant locations",
    new_merchant:   "Announce new merchants have joined and encourage users to visit",
    offline_spend:  "Remind users that spending at physical merchant locations earns them diamond rewards — encourage them to visit and spend",
  };

  let prompt;
  if (type === "new_merchant") {
    prompt = `You are a content creator for Bello App — Malaysia's first treasure-hunting app where users scan QR codes at merchant locations to collect Event Diamonds (ED) and redeem rewards.

A NEW MERCHANT has joined Bello App: ${merchantInfo}

Generate a CMS announcement in THREE languages.
Each: title (max 8 words), body (1-2 sentences, mention scanning QR + collecting Event Diamonds).
Malaysian casual tone. No hashtags.

Respond ONLY valid JSON, no markdown fences:
{"en":{"title":"...","body":"..."},"bm":{"title":"...","body":"..."},"zh":{"title":"...","body":"..."}}`;
  } else {
    const themeDesc = themeKey ? (themeDescriptions[themeKey] || themeLabel) : "Remind users to open Bello App and collect Event Diamonds today";
    prompt = `You are a content creator for Bello App — Malaysia's first treasure-hunting app where users scan QR codes at merchants to collect Event Diamonds (ED) and redeem rewards in the Diamond Mall.

Theme: ${themeDesc}

Generate a daily reminder in English, Bahasa Malaysia, and Chinese (Simplified, casual Malaysian).
Each: title (max 8 words), body (1-2 sentences, under 50 words, engaging).
Malaysian casual tone — "lah", "weh", "jom" where natural. Use "Bello Points" not "BP". No hashtags.

Respond ONLY valid JSON, no markdown fences:
{"en":{"title":"...","body":"..."},"bm":{"title":"...","body":"..."},"zh":{"title":"...","body":"..."}}`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.map((b) => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDate(date) {
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getMonth() + 1}月${date.getDate()}日（${days[date.getDay()]}）`;
}
