import { Bot } from "grammy";
import { config } from "./config.js";
import { db } from "./db.js";
import { allow, defaultRoles } from "./security.js";
import { duration, esc } from "./utils.js";
import { automod, verifyCaptcha } from "./automod.js";
import { getSettings } from "./groupSettings.js";
import { installBotMenus, sendMainMenu } from "./botMenus.js";
import { installExtraCommands } from "./extraCommands.js";
import { sendSticker } from "./brand.js";
export const bot = new Bot(config.BOT_TOKEN);
const no = { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_change_info: false, can_invite_users: false, can_pin_messages: false, can_manage_topics: false }, yes = { ...no, can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_invite_users: true };
const name = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ");
const ravvo = (text) => text;
bot.use(async (c, next) => { if (c.chat && c.from && ["group", "supergroup"].includes(c.chat.type)) {
    const groupId = String(c.chat.id), title = "title" in c.chat && c.chat.title ? c.chat.title : "Группа";
    await db.group.upsert({ where: { id: groupId }, create: { id: groupId, title }, update: { title, active: true } });
    let admin = false;
    try {
        admin = ["creator", "administrator"].includes((await c.api.getChatMember(c.chat.id, c.from.id)).status);
    }
    catch { }
    await db.member.upsert({ where: { groupId_telegramId: { groupId, telegramId: String(c.from.id) } }, create: { groupId, telegramId: String(c.from.id), username: c.from.username, name: name(c.from), nativeAdmin: admin }, update: { username: c.from.username, name: name(c.from), nativeAdmin: admin } });
    await defaultRoles(groupId);
} await next(); });
bot.use(automod);
bot.callbackQuery(/^verify:/, verifyCaptcha);
async function guard(c, p) { if (c.chat && c.from && await allow(String(c.chat.id), String(c.from.id), p))
    return true; await c.reply("<b>Недостаточно прав</b>\n\nОбратитесь к владельцу группы.", { parse_mode: "HTML" }); return false; }
async function target(c, a) { const u = c.message?.reply_to_message?.from; if (u)
    return { id: u.id, name: name(u), used: 0 }; const raw = a[0]; if (!raw)
    return null; const groupId = String(c.chat.id), m = raw.startsWith("@") ? await db.member.findFirst({ where: { groupId, username: raw.slice(1) } }) : await db.member.findUnique({ where: { groupId_telegramId: { groupId, telegramId: raw } } }); return m ? { id: Number(m.telegramId), name: m.name, used: 1 } : null; }
async function record(c, d) { await db.modAction.create({ data: { groupId: String(c.chat.id), type: d.type, actorId: String(c.from.id), actorName: name(c.from), targetId: d.t ? String(d.t.id) : null, targetName: d.t?.name, reason: d.reason, expiresAt: d.expiresAt, status: d.status ?? (d.expiresAt ? "ACTIVE" : "RESOLVED") } }); }
bot.command("start", async (c) => { await sendSticker(c, "welcome"); await sendMainMenu(c); });
bot.command("help", c => c.reply("<b>Справка Ravvo</b>\n\n<b>Управление</b>\n/menu · /settings · /reload\n\n<b>Модерация</b>\n/ban · /unban · /kick · /mute · /unmute\n/warn · /unwarn · /warns · /delete · /purge\n\n<b>Группа</b>\n/rules · /setrules · /announce · /send\n/pin · /pinned · /unpinall · /silence · /unsilence\n\n<b>Информация</b>\n/info · /staff · /me · /chatid · /link\n\n<b>Сервис</b>\n/order · /report\n\nИспользуйте команды модерации ответом на сообщение пользователя.", { parse_mode: "HTML" }));
for (const command of ["ban", "mute"])
    bot.command(command, async (c) => { const type = command.toUpperCase(); if (!await guard(c, type))
        return; const a = c.match.trim().split(/\s+/).filter(Boolean), t = await target(c, a); if (!t)
        return void c.reply("<b>Участник не найден</b>\n\nОтветьте на сообщение или укажите ID/@username.", { parse_mode: "HTML" }); const ms = duration(a[t.used]); if (!ms)
        return void c.reply("<b>Укажите срок</b>\n\nНапример: <code>15m</code>, <code>2h</code> или <code>7d</code>.", { parse_mode: "HTML" }); const reason = a.slice(t.used + 1).join(" ") || "Без причины", until = new Date(Date.now() + ms); if (type === "BAN")
        await c.api.banChatMember(c.chat.id, t.id, { until_date: Math.floor(until.getTime() / 1000) });
    else
        await c.api.restrictChatMember(c.chat.id, t.id, no, { until_date: Math.floor(until.getTime() / 1000) }); await record(c, { type, t, reason, expiresAt: until }); await c.reply(`<b>${type === "BAN" ? "Участник заблокирован" : "Участник ограничен"}</b>\n\n${esc(t.name)}\nПричина: ${esc(reason)}`, { parse_mode: "HTML" }); });
bot.command("unmute", async (c) => { if (!await guard(c, "MUTE"))
    return; const a = c.match.trim().split(/\s+/), t = await target(c, a); if (!t)
    return void c.reply("Ответьте на сообщение или укажите ID."); await c.api.restrictChatMember(c.chat.id, t.id, yes); await db.modAction.updateMany({ where: { groupId: String(c.chat.id), targetId: String(t.id), type: "MUTE", status: "ACTIVE" }, data: { status: "RESOLVED", resolvedAt: new Date() } }); await record(c, { type: "UNMUTE", t }); await c.reply(`<b>Ограничение снято</b>\n\n${esc(t.name)}`, { parse_mode: "HTML" }); });
bot.command("kick", async (c) => { if (!await guard(c, "KICK"))
    return; const a = c.match.trim().split(/\s+/), t = await target(c, a); if (!t)
    return void c.reply("Ответьте на сообщение или укажите ID."); const reason = a.slice(t.used).join(" ") || "Без причины"; await c.api.banChatMember(c.chat.id, t.id); await c.api.unbanChatMember(c.chat.id, t.id); await record(c, { type: "KICK", t, reason }); await c.reply(`<b>Участник исключён</b>\n\n${esc(t.name)}\nПричина: ${esc(reason)}`, { parse_mode: "HTML" }); });
bot.command("delete", async (c) => { if (!await guard(c, "DELETE"))
    return; const id = c.message?.reply_to_message?.message_id; if (!id)
    return void c.reply(ravvo("Используйте /delete ответом на сообщение.")); await c.api.deleteMessage(c.chat.id, id); await record(c, { type: "DELETE" }); try {
    await c.deleteMessage();
}
catch { } });
bot.command("rules", async (c) => { const g = await db.group.findUnique({ where: { id: String(c.chat.id) } }); await c.reply(`<b>Правила сообщества</b>\n\n${esc(g?.rules ?? "Правила пока не добавлены.")}`, { parse_mode: "HTML" }); });
bot.command("setrules", async (c) => { if (!await guard(c, "RULES_MANAGE"))
    return; const rules = c.match.trim(); if (!rules)
    return void c.reply("Добавьте текст после /setrules."); await db.group.update({ where: { id: String(c.chat.id) }, data: { rules } }); await record(c, { type: "RULES_UPDATE", reason: "Правила обновлены" }); await c.reply("<b>Правила сохранены</b>", { parse_mode: "HTML" }); });
bot.command("announce", async (c) => { if (!await guard(c, "ANNOUNCE"))
    return; const text = c.match.trim(); if (!text)
    return void c.reply("Добавьте текст после /announce."); const m = await c.reply(`<b>Объявление</b>\n\n${esc(text)}`, { parse_mode: "HTML" }); await db.announcement.create({ data: { groupId: String(c.chat.id), authorId: String(c.from?.id ?? 0), text, messageId: String(m.message_id) } }); await record(c, { type: "ANNOUNCE", reason: text.slice(0, 200) }); });
bot.command("role", async (c) => { if (!await guard(c, "ROLE_MANAGE"))
    return; const a = c.match.trim().split(/\s+/), op = a.shift(), t = await target(c, a); if (!t || !["give", "remove"].includes(op ?? ""))
    return void c.reply(ravvo("/role give|remove [user] роль")); const role = await db.role.findUnique({ where: { groupId_name: { groupId: String(c.chat.id), name: a[t.used]?.toLowerCase() ?? "" } } }), m = await db.member.findUnique({ where: { groupId_telegramId: { groupId: String(c.chat.id), telegramId: String(t.id) } } }); if (!role || !m)
    return void c.reply(ravvo("Роль или участник не найдены.")); if (op === "give")
    await db.memberRole.upsert({ where: { memberId_roleId: { memberId: m.id, roleId: role.id } }, create: { memberId: m.id, roleId: role.id }, update: {} });
else
    await db.memberRole.deleteMany({ where: { memberId: m.id, roleId: role.id } }); await record(c, { type: `ROLE_${(op ?? "").toUpperCase()}`, t, reason: role.name }); await c.reply(ravvo("✅ Роль обновлена.")); });
bot.command("warn", async (c) => { if (!await guard(c, "MUTE"))
    return; const a = c.match.trim().split(/\s+/), t = await target(c, a); if (!t)
    return void c.reply("Ответьте на сообщение или укажите ID."); const reason = a.slice(t.used).join(" ") || "Нарушение правил"; await record(c, { type: "WARN", t, reason, status: "ACTIVE" }); const count = await db.modAction.count({ where: { groupId: String(c.chat.id), targetId: String(t.id), type: "WARN", status: "ACTIVE" } }), settings = await getSettings(String(c.chat.id)); if (count >= settings.warnLimit) {
    if (settings.warnAction === "ban")
        await c.api.banChatMember(c.chat.id, t.id);
    else if (settings.warnAction === "kick") {
        await c.api.banChatMember(c.chat.id, t.id);
        await c.api.unbanChatMember(c.chat.id, t.id);
    }
    else
        await c.api.restrictChatMember(c.chat.id, t.id, no, { until_date: Math.floor(Date.now() / 1000) + 3600 });
    await db.modAction.updateMany({ where: { groupId: String(c.chat.id), targetId: String(t.id), type: "WARN", status: "ACTIVE" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
} await c.reply(`<b>Предупреждение выдано</b>\n\n${esc(t.name)}\n${esc(reason)}\n\n${count} из ${settings.warnLimit}`, { parse_mode: "HTML" }); });
bot.command("unwarn", async (c) => { if (!await guard(c, "MUTE"))
    return; const a = c.match.trim().split(/\s+/), t = await target(c, a); if (!t)
    return void c.reply(ravvo("Укажите пользователя.")); const last = await db.modAction.findFirst({ where: { groupId: String(c.chat.id), targetId: String(t.id), type: "WARN", status: "ACTIVE" }, orderBy: { createdAt: "desc" } }); if (last)
    await db.modAction.update({ where: { id: last.id }, data: { status: "RESOLVED", resolvedAt: new Date() } }); await c.reply(ravvo(last ? "✅ Одно предупреждение снято." : "Активных предупреждений нет.")); });
bot.command("report", async (c) => { if (!c.message || !c.from)
    return; const msg = c.message.reply_to_message; if (!msg)
    return void c.reply("Ответьте командой /report на сообщение."); const reporter = c.from.username ? `@${c.from.username}` : name(c.from), targetName = msg.from ? (msg.from.username ? `@${msg.from.username}` : name(msg.from)) : "неизвестного пользователя"; await c.reply(`<b>Жалоба отправлена</b>\n\nОт: ${esc(reporter)}\nНа: ${esc(targetName)}\n\nАдминистраторы получили уведомление.`, { parse_mode: "HTML", reply_parameters: { message_id: msg.message_id } }); });
bot.on("my_chat_member", async (c) => { const status = c.myChatMember.new_chat_member.status; if (!["member", "administrator"].includes(status) || !["group", "supergroup"].includes(c.chat.type))
    return; const admin = status === "administrator"; await c.reply(`<b>Ravvo подключён</b>\n\n${admin ? "Бот получил административные права и готов к настройке." : "Бот добавлен как обычный участник. Для полноценной модерации назначьте его администратором."}\n\n<b>Рекомендуемый порядок настройки</b>\n1. Откройте /settings.\n2. Настройте приветствие и правила.\n3. Включите CAPTCHA, защиту ссылок и стоп-слова.\n4. Проверьте права модераторов.\n\nСправка по всем командам доступна через /help.`, { parse_mode: "HTML" }); });
installExtraCommands(bot);
installBotMenus(bot);
bot.catch(e => { console.error(e.error); e.ctx.reply("<b>Не удалось выполнить действие</b>\n\nПроверьте права бота и формат команды.", { parse_mode: "HTML" }).catch(() => { }); });
export async function expire() { const list = await db.modAction.findMany({ where: { status: "ACTIVE", expiresAt: { lte: new Date() } } }); for (const a of list)
    try {
        if (a.type === "BAN" && a.targetId)
            await bot.api.unbanChatMember(Number(a.groupId), Number(a.targetId), { only_if_banned: true });
        if (a.type === "MUTE" && a.targetId)
            await bot.api.restrictChatMember(Number(a.groupId), Number(a.targetId), yes);
        await db.modAction.update({ where: { id: a.id }, data: { status: "EXPIRED", resolvedAt: new Date() } });
    }
    catch (e) {
        console.error(e);
    } }
