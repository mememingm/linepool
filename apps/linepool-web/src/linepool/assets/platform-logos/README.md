# 海外平台 Logo 素材

已收集 **50 / 50** 个真实 SVG，收集日期（UTC）：2026-10-15T08:48:33+00:00。

范围覆盖社交/通讯、视频/内容、办公/邮箱、电商/支付、开发者、AI、出行/旅游；ChatGPT / OpenAI 共用 `openai.svg`。Telegram 和 TikTok 分别为 `logos/telegram.svg`、`logos/tiktok.svg`。

## 使用

直接打开 `index.html` 查看全部缩略图；素材使用相对路径，无网络运行依赖。SVG 保持透明画布，部分品牌图案自身包含实色底形。预览卡片可链接打开原始 SVG。

`manifest.json` 逐项记录名称、稳定 slug、本地文件、来源 URL、官网、可确认的品牌规范/上游引用页、格式、尺寸/viewBox、字节数、SHA256、UTC 收集时间和来源说明。`source_sha256` 是下载原文哈希，`sha256` 是本地最终文件哈希。

## 来源和商标

优先批量采用可信的 [SVG Logos / gilbarbara/logos](https://github.com/gilbarbara/logos)（Iconify logos 上游），保留原始多色/渐变。缺项采用 [Simple Icons 11.15.0](https://github.com/simple-icons/simple-icons/tree/11.15.0) 的真实路径，并按该版本元数据品牌色填充；Booking.com 来自 Wikimedia Commons 的平台矢量标志。各来源的许可 URL 及品牌参考页已记入清单。

单色品牌色补齐项目：X、Snapchat、LINE、Viber、Outlook、Amazon、eBay、Uber。例如 eBay 和 Amazon 使用单色版本，并非它们的多色组合标志；Snapchat 的品牌黄在浅底上对比度较低，预览采用灰底。库的 CC0 许可不授予品牌商标使用权，也不代表品牌官方授权或背书；实际公开使用需遵守各品牌规范。历史固定版本可能包含旧图形/色值；本素材库不宣称全部为最新品牌版本。未逐一漫游官网确认最新规范。

## 重复下载与校验

仅依赖现有 Python 3 标准库，在任意工作目录运行：

```sh
python collect_logos.py
python collect_logos.py --validate
```

脚本只写自身所在目录，不清空目录、不删除既有文件、不安装依赖。网络超时 25 秒、并发 4，不重试 403/429 等访问限制。`gilbarbara/logos` 的 `main` 及 Wikimedia 文件可能更新，重跑后的哈希可能变化；Simple Icons 固定为 11.15.0。下载失败时保留上次已验证文件并明确记录，本次失败不伪装成新下载。

校验实际文件非空、SVG XML、viewBox/绝对尺寸、矢量路径、哈希/字节数、清单与 SVG 一一对应、全部目标及 Telegram/TikTok 必备；拒绝 HTML、DTD、脚本、事件、动画、外部引用和嵌入图片。SVG 内部 `url(#id)` 渐变引用和惰性的来源元数据 URL 保留。

## 失败项

无。
