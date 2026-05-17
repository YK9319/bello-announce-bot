const { chromium } = require("playwright");

const CMS_URL = "https://bello-admin.vercel.app";
const LOGIN_URL = `${CMS_URL}/user/login`;
const NEW_MSG_URL = `${CMS_URL}/message-manage/message-setting/operation`;

/**
 * Main entry — called by index.js after all 7 days approved
 * @param {Array} announcements - array of approved day objects
 */
async function publishToCMS(announcements, onProgress) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  const results = [];

  try {
    // ── LOGIN ──────────────────────────────────────────────────────────────
    console.log("Logging in to Bello CMS...");
    if (onProgress) await onProgress(`🔐 正在登录 Bello CMS...`);

    await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
    await page.fill('input[placeholder="请输入用户名"]', process.env.CMS_USERNAME);
    await page.fill('input[placeholder="请输入密码"]', process.env.CMS_PASSWORD);

    // Wait for Cloudflare turnstile if present
    await page.waitForTimeout(2000);

    await page.click('button:has-text("登录")');
    await page.waitForURL(`${CMS_URL}/**`, { timeout: 15000 });
    console.log("Login successful.");
    if (onProgress) await onProgress(`✅ 登录成功，开始发布 ${announcements.length} 条公告...`);

    // ── PUBLISH EACH DAY ───────────────────────────────────────────────────
    for (let i = 0; i < announcements.length; i++) {
      const ann = announcements[i];
      const label = `Day ${i + 1}／${announcements.length}（${ann.dayLabel} · ${ann.theme}）`;
      console.log(`Publishing ${label}...`);
      if (onProgress) await onProgress(`⏳ 正在发布 ${label}...`);

      try {
        await publishOne(page, ann);
        results.push({ day: ann.dayLabel, status: "success" });
        console.log(`✅ ${label} published.`);
        if (onProgress) await onProgress(`✅ ${label} 发布成功！`);
      } catch (err) {
        console.error(`❌ ${label} failed: ${err.message}`);
        results.push({ day: ann.dayLabel, status: "failed", error: err.message });
        await page.screenshot({ path: `/tmp/error_day${i + 1}.png` });
        if (onProgress) await onProgress(`❌ ${label} 失败：${err.message}`);
      }

      // Small delay between submissions
      await page.waitForTimeout(1500);
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function publishOne(page, ann) {
  // Navigate to new message form
  await page.goto(NEW_MSG_URL, { waitUntil: "networkidle" });

  // ── 类型: 公告 ────────────────────────────────────────────────────────
  await page.click('label:has-text("公告")');

  // ── 发送对象: 全部用户 (already default, confirm) ────────────────────
  await page.click('label:has-text("全部用户")');

  // ── 发送时间: 定时发送 ────────────────────────────────────────────────
  await page.click('label:has-text("定时发送")');
  await page.waitForTimeout(500);

  // Fill datetime — click the input to open picker
  await page.click('input[placeholder="请选择发送时间"]');
  await page.waitForTimeout(500);

  // Type date directly into input (antd allows this)
  const dateStr = buildDateStr(ann.date);
  await page.fill('input[placeholder="请选择发送时间"]', dateStr);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  // If calendar still open, click 确定
  const confirmBtn = page.locator('.ant-picker-ok button, button:has-text("确定")');
  if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await page.waitForTimeout(300);

  // ── 英语 ──────────────────────────────────────────────────────────────
  await page.click('.ant-tabs-tab:has-text("英语"), [data-node-key="en"], li:has-text("英语")');
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="请输入标题"]', ann.en.title);
  await fillRichText(page, ann.en.body);

  // ── 马来语 ────────────────────────────────────────────────────────────
  await page.click('.ant-tabs-tab:has-text("马来语"), [data-node-key="ms"], li:has-text("马来语")');
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="请输入标题"]', ann.bm.title);
  await fillRichText(page, ann.bm.body);

  // ── 简体中文 ──────────────────────────────────────────────────────────
  await page.click('.ant-tabs-tab:has-text("简体中文"), [data-node-key="zh"], li:has-text("简体中文")');
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="请输入标题"]', ann.zh.title);
  await fillRichText(page, ann.zh.body);

  // ── 提交 ──────────────────────────────────────────────────────────────
  await page.click('button:has-text("提交")');

  // Wait for success — either redirect or success toast
  await Promise.race([
    page.waitForURL("**/message-setting", { timeout: 10000 }),
    page.waitForSelector('.ant-message-success, .ant-notification-notice-success', { timeout: 10000 }),
  ]);
}

async function fillRichText(page, text) {
  // The rich text editor (likely wangEditor or similar) — click content area and type
  const editor = page.locator('.w-e-text-container [contenteditable="true"], .ql-editor, [contenteditable="true"]').last();
  await editor.click();
  await editor.fill(text);
}

function buildDateStr(date) {
  // Format: YYYY-MM-DD HH:mm:ss for antd picker
  const d = new Date(date);
  // Set to 10:00 AM
  d.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = { publishToCMS };
