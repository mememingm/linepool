/**
 * platform-catalog.ts 中文分区导读副本：服务平台品牌目录
 * 原文件：packages/contracts/src/platform-catalog.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。多数规则使用 Zod 描述输入或返回格式，类型声明供编辑器检查。
 * 【整体用途】保存平台的展示名称、网址代号及热门标记。
 * 【为什么这样组织】品牌展示元数据与真实可售库存分开维护；是否可买由商品和库存决定。
 * 【调用链】Workspace.catalog 将此目录与实际 offers 库存组合后返回前台。
 * 【修改提示】添加一项需提供 name、slug、popular；只添加品牌不会自动接入该平台或创建商品。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
// Brand metadata only. Availability is derived from configured offers and inventory.
/**
 * platformCatalog = 服务平台展示目录。name 是名称，slug 是展示用代号，popular 是是否热门；不代表已有库存或实际接入。
 */
export const platformCatalog = [
  {
    "name": "Telegram",
    "slug": "telegram",
    "popular": true
  },
  {
    "name": "TikTok",
    "slug": "tiktok",
    "popular": true
  },
  {
    "name": "Instagram",
    "slug": "instagram",
    "popular": true
  },
  {
    "name": "Facebook",
    "slug": "facebook",
    "popular": true
  },
  {
    "name": "Messenger",
    "slug": "messenger",
    "popular": false
  },
  {
    "name": "WhatsApp",
    "slug": "whatsapp",
    "popular": true
  },
  {
    "name": "X",
    "slug": "x",
    "popular": false
  },
  {
    "name": "YouTube",
    "slug": "youtube",
    "popular": false
  },
  {
    "name": "Snapchat",
    "slug": "snapchat",
    "popular": false
  },
  {
    "name": "Reddit",
    "slug": "reddit",
    "popular": false
  },
  {
    "name": "Pinterest",
    "slug": "pinterest",
    "popular": false
  },
  {
    "name": "LinkedIn",
    "slug": "linkedin",
    "popular": false
  },
  {
    "name": "Discord",
    "slug": "discord",
    "popular": true
  },
  {
    "name": "Threads",
    "slug": "threads",
    "popular": false
  },
  {
    "name": "Twitch",
    "slug": "twitch",
    "popular": false
  },
  {
    "name": "Bluesky",
    "slug": "bluesky",
    "popular": false
  },
  {
    "name": "Tumblr",
    "slug": "tumblr",
    "popular": false
  },
  {
    "name": "Medium",
    "slug": "medium",
    "popular": false
  },
  {
    "name": "Quora",
    "slug": "quora",
    "popular": false
  },
  {
    "name": "LINE",
    "slug": "line",
    "popular": false
  },
  {
    "name": "Signal",
    "slug": "signal",
    "popular": false
  },
  {
    "name": "Viber",
    "slug": "viber",
    "popular": false
  },
  {
    "name": "Slack",
    "slug": "slack",
    "popular": false
  },
  {
    "name": "Zoom",
    "slug": "zoom",
    "popular": false
  },
  {
    "name": "Google",
    "slug": "google",
    "popular": true
  },
  {
    "name": "Gmail",
    "slug": "gmail",
    "popular": false
  },
  {
    "name": "Microsoft",
    "slug": "microsoft",
    "popular": false
  },
  {
    "name": "Outlook",
    "slug": "outlook",
    "popular": false
  },
  {
    "name": "Apple",
    "slug": "apple",
    "popular": false
  },
  {
    "name": "Yahoo",
    "slug": "yahoo",
    "popular": false
  },
  {
    "name": "Amazon",
    "slug": "amazon",
    "popular": false
  },
  {
    "name": "eBay",
    "slug": "ebay",
    "popular": false
  },
  {
    "name": "PayPal",
    "slug": "paypal",
    "popular": false
  },
  {
    "name": "Stripe",
    "slug": "stripe",
    "popular": false
  },
  {
    "name": "Shopify",
    "slug": "shopify",
    "popular": false
  },
  {
    "name": "Spotify",
    "slug": "spotify",
    "popular": false
  },
  {
    "name": "Netflix",
    "slug": "netflix",
    "popular": false
  },
  {
    "name": "Steam",
    "slug": "steam",
    "popular": false
  },
  {
    "name": "GitHub",
    "slug": "github",
    "popular": false
  },
  {
    "name": "GitLab",
    "slug": "gitlab",
    "popular": false
  },
  {
    "name": "Stack Overflow",
    "slug": "stack-overflow",
    "popular": false
  },
  {
    "name": "ChatGPT / OpenAI",
    "slug": "openai",
    "popular": true
  },
  {
    "name": "Claude",
    "slug": "claude",
    "popular": false
  },
  {
    "name": "Google Gemini",
    "slug": "google-gemini",
    "popular": false
  },
  {
    "name": "Perplexity",
    "slug": "perplexity",
    "popular": false
  },
  {
    "name": "Notion",
    "slug": "notion",
    "popular": false
  },
  {
    "name": "Dropbox",
    "slug": "dropbox",
    "popular": false
  },
  {
    "name": "Uber",
    "slug": "uber",
    "popular": false
  },
  {
    "name": "Airbnb",
    "slug": "airbnb",
    "popular": false
  },
  {
    "name": "Booking.com",
    "slug": "booking-com",
    "popular": false
  }
] as const;
