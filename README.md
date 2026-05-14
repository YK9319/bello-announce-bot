# Bello Announce Bot

Telegram bot that uses Claude AI to generate trilingual (EN/BM/ZH) CMS announcements for Bello App.

## Features
- `/generate <merchant info>` — Generate new merchant announcement
- `/daily` — Generate a daily user reminder
- Inline approve / reject buttons for review before publishing
- Deployed on Railway (24/7, no local machine needed)

## Setup

### 1. Environment Variables
Set these in Railway dashboard:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 2. Deploy to Railway
1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Select this repo
4. Add the environment variables above
5. Deploy

## Usage
In your Telegram group:
- `/start` or `/help` — Show commands
- `/generate Kedai Kopi Uncle Lim, SS15 Subang Jaya` — New merchant announcement
- `/daily` — Generate today's user reminder

After generation, tap ✅ to approve or ❌ to reject.
Approved content is formatted and ready to paste into Bello CMS.
