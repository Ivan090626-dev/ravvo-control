import express from "express";
import cors from "cors";
import helmet from "helmet";
import { InlineKeyboard, InputFile } from "grammy";
import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db.js";
import { bot } from "./bot.js";
import { duration, esc } from "./utils.js";
import { defaults, getSettings, saveSettings } from "./groupSettings.js";
import { verifyTelegramInitData } from "./telegramAuth.js";
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.WEB_ORIGIN === "*" ? true : config.WEB_ORIGIN }));
app.use(express.json({ limit: "4mb" }));
app.get("/health", (_q, s) => s.json({ ok: true, brand: "Ravvo" }));
app.use("/api", (q, s, n) => { const init = String(q.headers["x-telegram-init-data"] || ""); const user = verifyTelegramInitData(init); if (user) {
    q.telegramUser = user;
    return n();
} if (!config.WEBAPP_URL && ["localhost", "127.0.0.1"].includes(q.hostname))
    return n(); return s.status(401).json({ error: "Откройте приложение через кнопку Telegram" }); });
function owner(q, s, n) { if (!config.ADMIN_TELEGRAM_ID)
    return s.status(503).json({ error: "Укажите ADMIN_TELEGRAM_ID в .env" }); if (q.telegramUser && String(q.telegramUser.id) !== config.ADMIN_TELEGRAM_ID)
    return s.status(403).json({ error: "Этот раздел доступен только владельцу Ravvo" }); if (!q.telegramUser && config.WEBAPP_URL)
    return s.status(403).json({ error: "Откройте панель из аккаунта владельца в Telegram" }); n(); }
app.get("/api/me", (q, s) => s.json({ user: q.telegramUser || { id: 0, first_name: "Локальная проверка" }, isOwner: !q.telegramUser || String(q.telegramUser.id) === config.ADMIN_TELEGRAM_ID, brand: "Ravvo" }));
app.get("/api/overview", async (_q, s) => { const [groups, active, actions, announcements] = await Promise.all([db.group.findMany({ where: { active: true }, include: { _count: { select: { members: true, actions: true } } }, orderBy: { updatedAt: "desc" } }), db.modAction.count({ where: { status: "ACTIVE" } }), db.modAction.findMany({ take: 30, orderBy: { createdAt: "desc" } }), db.announcement.count()]); s.json({ groups, active, actions, announcements }); });
app.get("/api/groups/:id/members", owner, async (q, s) => { const members = await db.member.findMany({ where: { groupId: String(q.params.id) }, orderBy: { name: "asc" }, take: 250 }); s.json(members); });
app.put("/api/groups/:id/rules", owner, async (q, s) => { const p = z.object({ rules: z.string().min(1).max(4000), publish: z.boolean() }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Проверьте правила" }); const g = await db.group.update({ where: { id: String(q.params.id) }, data: { rules: p.data.rules } }); if (p.data.publish)
    await bot.api.sendMessage(Number(g.id), `📜 <b>Правила сообщества</b>\n\n${esc(g.rules)}\n\n<i>Управление сообществом — Ravvo</i>`, { parse_mode: "HTML" }); s.json(g); });
app.post("/api/groups/:id/announcements", owner, async (q, s) => { const p = z.object({ title: z.string().max(100).optional(), text: z.string().min(1).max(4000), buttons: z.array(z.object({ text: z.string().min(1).max(64), url: z.string().url().refine(v => v.startsWith("https://") || v.startsWith("http://"), "URL должен начинаться с http:// или https://") })).max(12).default([]) }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Проверьте текст" }); const keyboard = p.data.buttons.length ? p.data.buttons.reduce((kb, b, i) => { kb.url(b.text, b.url); if (i % 2 === 1)
    kb.row(); return kb; }, new InlineKeyboard()) : undefined; const m = await bot.api.sendMessage(Number(q.params.id), `📣 <b>${esc(p.data.title || "Объявление")}</b>\n\n${esc(p.data.text)}\n\n<i>Опубликовано через Ravvo</i>`, { parse_mode: "HTML", reply_markup: keyboard }); const a = await db.announcement.create({ data: { groupId: String(q.params.id), authorId: String(q.telegramUser?.id || "local"), title: p.data.title, text: p.data.text, buttons: JSON.stringify(p.data.buttons), messageId: String(m.message_id) } }); s.json(a); });
app.post("/api/groups/:id/moderation/ban", owner, async (q, s) => { const p = z.object({ targetId: z.string().regex(/^\d+$/), duration: z.string().regex(/^\d+(s|m|h|d|w)$/i), reason: z.string().min(2).max(500) }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Укажите пользователя, срок (например 15m) и причину" }); const ms = duration(p.data.duration); if (!ms)
    return s.status(400).json({ error: "Некорректный срок наказания" }); const until = new Date(Date.now() + ms), member = await db.member.findUnique({ where: { groupId_telegramId: { groupId: String(q.params.id), telegramId: p.data.targetId } } }); await bot.api.banChatMember(Number(q.params.id), Number(p.data.targetId), { until_date: Math.floor(until.getTime() / 1000) }); await db.modAction.create({ data: { groupId: String(q.params.id), type: "BAN", actorId: String(q.telegramUser?.id || "panel"), actorName: q.telegramUser?.first_name || "Ravvo Panel", targetId: p.data.targetId, targetName: member?.name || p.data.targetId, reason: p.data.reason, status: "ACTIVE", expiresAt: until } }); s.status(201).json({ ok: true, until, targetName: member?.name || p.data.targetId }); });
app.put("/api/groups/:id/settings", owner, async (q, s) => { const p = z.object({ title: z.string().min(1).max(128) }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Название должно содержать 1–128 символов" }); await bot.api.setChatTitle(Number(q.params.id), p.data.title); const g = await db.group.update({ where: { id: String(q.params.id) }, data: { title: p.data.title } }); s.json(g); });
app.put("/api/groups/:id/avatar", owner, async (q, s) => { const p = z.object({ image: z.string().regex(/^data:image\/(jpeg|jpg|png);base64,/) }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Выберите изображение JPG или PNG" }); const raw = p.data.image.replace(/^data:image\/[\w+.-]+;base64,/, ""), buffer = Buffer.from(raw, "base64"); if (buffer.length > 3_000_000)
    return s.status(400).json({ error: "Изображение должно быть меньше 3 МБ" }); await bot.api.setChatPhoto(Number(q.params.id), new InputFile(buffer, "ravvo-group-avatar.jpg")); s.json({ ok: true }); });
const settingsSchema = z.object({ welcomeEnabled: z.boolean(), welcomeText: z.string().max(1000), goodbyeEnabled: z.boolean(), goodbyeText: z.string().max(1000), captchaEnabled: z.boolean(), captchaMinutes: z.number().min(1).max(30), antiLinks: z.boolean(), allowedDomains: z.array(z.string().max(100)).max(50), antiFlood: z.boolean(), floodMessages: z.number().min(3).max(30), floodSeconds: z.number().min(2).max(120), antiCaps: z.boolean(), capsPercent: z.number().min(50).max(100), badWordsEnabled: z.boolean(), badWords: z.array(z.string().max(100)).max(200), blockForwards: z.boolean(), blockMedia: z.boolean(), warnLimit: z.number().min(1).max(10), warnAction: z.enum(["mute", "kick", "ban"]), logActions: z.boolean(), deleteServiceMessages: z.boolean() });
app.get("/api/groups/:id/automod", owner, async (q, s) => s.json(await getSettings(String(q.params.id))));
app.put("/api/groups/:id/automod", owner, async (q, s) => { const p = settingsSchema.safeParse({ ...defaults, ...q.body }); if (!p.success)
    return s.status(400).json({ error: "Проверьте настройки автомодерации" }); s.json(await saveSettings(String(q.params.id), p.data)); });
app.get("/api/groups/:id/reminders", owner, async (q, s) => s.json(await db.reminder.findMany({ where: { groupId: String(q.params.id) }, orderBy: { createdAt: "desc" } })));
app.post("/api/groups/:id/reminders", owner, async (q, s) => { const p = z.object({ text: z.string().min(1).max(3500), intervalHours: z.number().min(0.25).max(8760) }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Введите текст и интервал от 0.25 до 8760 часов" }); const item = await db.reminder.create({ data: { groupId: String(q.params.id), text: p.data.text, intervalHours: p.data.intervalHours, nextRunAt: new Date(Date.now() + p.data.intervalHours * 3_600_000) } }); s.status(201).json(item); });
app.put("/api/groups/:groupId/reminders/:id", owner, async (q, s) => { const p = z.object({ enabled: z.boolean() }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Некорректное состояние" }); const item = await db.reminder.update({ where: { id: Number(q.params.id), groupId: String(q.params.groupId) }, data: { enabled: p.data.enabled, ...(p.data.enabled ? { nextRunAt: new Date(Date.now() + 60_000) } : {}) } }); s.json(item); });
app.delete("/api/groups/:groupId/reminders/:id", owner, async (q, s) => { await db.reminder.delete({ where: { id: Number(q.params.id), groupId: String(q.params.groupId) } }); s.json({ ok: true }); });
app.post("/api/groups/:groupId/reminders/:id/send", owner, async (q, s) => { const item = await db.reminder.findUnique({ where: { id: Number(q.params.id), groupId: String(q.params.groupId) } }); if (!item)
    return s.status(404).json({ error: "Напоминание не найдено" }); await bot.api.sendMessage(Number(item.groupId), `⏰ <b>Напоминание</b>\n\n${esc(item.text)}\n\n<i>Автоматическое сообщение · Ravvo</i>`, { parse_mode: "HTML" }); const now = new Date(); await db.reminder.update({ where: { id: item.id }, data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + item.intervalHours * 3_600_000) } }); s.json({ ok: true }); });
app.post("/api/plugin-requests", async (q, s) => { const p = z.object({ minecraftVersion: z.string().min(2).max(30), javaVersion: z.string().min(1).max(20), serverCore: z.string().min(2).max(50), description: z.string().min(20).max(3000) }).safeParse(q.body); if (!p.success)
    return s.status(400).json({ error: "Заполните все поля; описание — не короче 20 символов" }); if (!config.ADMIN_TELEGRAM_ID)
    return s.status(503).json({ error: "Владелец ещё не указал ADMIN_TELEGRAM_ID" }); const u = q.telegramUser, contact = u ? ([u.first_name, u.last_name].filter(Boolean).join(" ") + (u.username ? " (@" + u.username + ")" : "") + " · ID " + u.id) : "Локальная проверка"; const message = "🧩 <b>Новая заявка на Java-плагин</b>\n\n<b>Клиент:</b> " + esc(contact) + "\n<b>Minecraft:</b> " + esc(p.data.minecraftVersion) + "\n<b>Java:</b> " + esc(p.data.javaVersion) + "\n<b>Ядро:</b> " + esc(p.data.serverCore) + "\n\n<b>Описание:</b>\n" + esc(p.data.description) + "\n\n<i>Заявка через Ravvo Mini App</i>"; await bot.api.sendMessage(Number(config.ADMIN_TELEGRAM_ID), message, { parse_mode: "HTML" }); s.status(201).json({ ok: true }); });
app.use((e, _q, s, _n) => { console.error(e); s.status(500).json({ error: "Не удалось выполнить действие. Проверьте права бота в группе" }); });
export const startApi = () => app.listen(config.PORT, () => console.log(`Ravvo Panel API: http://localhost:${config.PORT}`));
