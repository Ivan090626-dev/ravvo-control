import { db } from "./db.js";
import { allow } from "./security.js";
import { esc } from "./utils.js";
import { sendMainMenu } from "./botMenus.js";
const muted = {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false,
};
const open = {
    ...muted,
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_invite_users: true,
};
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ");
async function guard(c, permission) {
    if (c.chat && c.from && ["group", "supergroup"].includes(c.chat.type) && (await allow(String(c.chat.id), String(c.from.id), permission))) {
        return true;
    }
    await c.reply("<b>Недостаточно прав</b>\n\nОбратитесь к владельцу группы.", { parse_mode: "HTML" });
    return false;
}
async function resolveTarget(c) {
    const reply = c.message?.reply_to_message?.from;
    if (reply)
        return { id: reply.id, name: fullName(reply) };
    const raw = String(c.match ?? "").trim().split(/\s+/)[0];
    if (!raw || !c.chat)
        return null;
    const groupId = String(c.chat.id);
    const member = raw.startsWith("@")
        ? await db.member.findFirst({ where: { groupId, username: raw.slice(1) } })
        : await db.member.findUnique({ where: { groupId_telegramId: { groupId, telegramId: raw } } });
    return member ? { id: Number(member.telegramId), name: member.name } : null;
}
export function installExtraCommands(bot) {
    bot.command("settings", sendMainMenu);
    bot.command("config", sendMainMenu);
    bot.command("chatid", async (c) => {
        await c.reply(`<b>ID чата</b>\n<code>${c.chat.id}</code>`, { parse_mode: "HTML" });
    });
    bot.command("me", async (c) => {
        if (!c.from)
            return;
        await c.reply(`<b>Ваш профиль</b>\n\nИмя: ${esc(fullName(c.from))}\nUsername: ${c.from.username ? `@${esc(c.from.username)}` : "не указан"}\nID: <code>${c.from.id}</code>`, { parse_mode: "HTML" });
    });
    bot.command("info", async (c) => {
        if (!c.from)
            return;
        if (!["group", "supergroup"].includes(c.chat.type))
            return c.reply("Используйте команду в группе.");
        const target = (await resolveTarget(c)) ?? { id: c.from.id, name: fullName(c.from) };
        let status = "участник";
        try {
            status = (await c.api.getChatMember(c.chat.id, target.id)).status;
        }
        catch { }
        const warnings = await db.modAction.count({
            where: { groupId: String(c.chat.id), targetId: String(target.id), type: "WARN", status: "ACTIVE" },
        });
        const member = await db.member.findUnique({
            where: { groupId_telegramId: { groupId: String(c.chat.id), telegramId: String(target.id) } },
            include: { roles: { include: { role: true } } },
        });
        const roles = member?.roles.map((item) => item.role.name).join(", ") || "нет";
        await c.reply(`<b>Участник</b>\n\n<a href="tg://user?id=${target.id}">${esc(target.name)}</a>\nID: <code>${target.id}</code>\nСтатус: ${esc(status)}\nРоли Ravvo: ${esc(roles)}\nПредупреждения: ${warnings}`, { parse_mode: "HTML" });
    });
    bot.command("warns", async (c) => {
        if (!c.from)
            return;
        if (!["group", "supergroup"].includes(c.chat.type))
            return c.reply("Используйте команду в группе.");
        const target = (await resolveTarget(c)) ?? { id: c.from.id, name: fullName(c.from) };
        const warnings = await db.modAction.findMany({
            where: { groupId: String(c.chat.id), targetId: String(target.id), type: "WARN", status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 10,
        });
        const list = warnings.length
            ? warnings.map((warning, index) => `${index + 1}. ${esc(warning.reason ?? "Без причины")}`).join("\n")
            : "Активных предупреждений нет.";
        await c.reply(`<b>Предупреждения · ${esc(target.name)}</b>\n\n${list}`, { parse_mode: "HTML" });
    });
    bot.command("staff", async (c) => {
        if (!["group", "supergroup"].includes(c.chat.type))
            return c.reply("Используйте команду в группе.");
        const admins = await c.api.getChatAdministrators(c.chat.id);
        const rows = admins
            .filter((item) => !item.user.is_bot)
            .map((item) => `• <a href="tg://user?id=${item.user.id}">${esc(fullName(item.user))}</a> · ${item.status === "creator" ? "владелец" : "администратор"}`);
        await c.reply(`<b>Команда группы</b>\n\n${rows.join("\n") || "Администраторы не найдены."}`, { parse_mode: "HTML" });
    });
    bot.command("reload", async (c) => {
        if (!(await guard(c, "ROLE_MANAGE")))
            return;
        const admins = await c.api.getChatAdministrators(c.chat.id);
        await db.member.updateMany({ where: { groupId: String(c.chat.id) }, data: { nativeAdmin: false } });
        for (const item of admins) {
            await db.member.upsert({
                where: { groupId_telegramId: { groupId: String(c.chat.id), telegramId: String(item.user.id) } },
                create: {
                    groupId: String(c.chat.id),
                    telegramId: String(item.user.id),
                    username: item.user.username,
                    name: fullName(item.user),
                    nativeAdmin: true,
                },
                update: { username: item.user.username, name: fullName(item.user), nativeAdmin: true },
            });
        }
        await c.reply(`<b>Список администраторов обновлён</b>\n\nНайдено: ${admins.length}`, { parse_mode: "HTML" });
    });
    bot.command("unban", async (c) => {
        if (!(await guard(c, "BAN")))
            return;
        const target = await resolveTarget(c);
        if (!target)
            return c.reply("Ответьте на сообщение пользователя или укажите его ID.");
        await c.api.unbanChatMember(c.chat.id, target.id, { only_if_banned: true });
        await db.modAction.updateMany({
            where: { groupId: String(c.chat.id), targetId: String(target.id), type: "BAN", status: "ACTIVE" },
            data: { status: "RESOLVED", resolvedAt: new Date() },
        });
        await c.reply(`<b>Блокировка снята</b>\n\n${esc(target.name)}`, { parse_mode: "HTML" });
    });
    bot.command("purge", async (c) => {
        if (!(await guard(c, "DELETE")))
            return;
        const start = c.message?.reply_to_message?.message_id;
        const end = c.message?.message_id;
        if (!start || !end)
            return c.reply("Ответьте командой /purge на первое сообщение диапазона.");
        const ids = Array.from({ length: Math.min(end - start + 1, 100) }, (_, index) => start + index);
        let deleted = 0;
        for (const id of ids) {
            try {
                await c.api.deleteMessage(c.chat.id, id);
                deleted++;
            }
            catch { }
        }
        if (deleted)
            await c.reply(`<b>Очистка завершена</b>\n\nУдалено сообщений: ${deleted}`, { parse_mode: "HTML" });
    });
    bot.command("pin", async (c) => {
        if (!(await guard(c, "ANNOUNCE")))
            return;
        const replyId = c.message?.reply_to_message?.message_id;
        const text = c.match.trim();
        const messageId = replyId ?? (text ? (await c.reply(text)).message_id : null);
        if (!messageId)
            return c.reply("Ответьте на сообщение или добавьте текст после /pin.");
        await c.api.pinChatMessage(c.chat.id, messageId, { disable_notification: true });
        await c.reply("<b>Сообщение закреплено</b>", { parse_mode: "HTML" });
    });
    bot.command("unpinall", async (c) => {
        if (!(await guard(c, "ANNOUNCE")))
            return;
        await c.api.unpinAllChatMessages(c.chat.id);
        await c.reply("<b>Все закрепления сняты</b>", { parse_mode: "HTML" });
    });
    bot.command("pinned", async (c) => {
        const chat = await c.api.getChat(c.chat.id);
        if (!chat.pinned_message)
            return c.reply("Закреплённого сообщения нет.");
        await c.reply("Закреплённое сообщение:", { reply_parameters: { message_id: chat.pinned_message.message_id } });
    });
    bot.command("send", async (c) => {
        if (!(await guard(c, "ANNOUNCE")))
            return;
        const text = c.match.trim();
        if (!text)
            return c.reply("Добавьте текст после /send.");
        await c.reply(text);
        try {
            await c.deleteMessage();
        }
        catch { }
    });
    bot.command("silence", async (c) => {
        if (!(await guard(c, "MUTE")))
            return;
        await c.api.setChatPermissions(c.chat.id, muted);
        await c.reply("<b>Режим тишины включён</b>\n\nОтправлять сообщения могут только администраторы.", { parse_mode: "HTML" });
    });
    bot.command("unsilence", async (c) => {
        if (!(await guard(c, "MUTE")))
            return;
        await c.api.setChatPermissions(c.chat.id, open);
        await c.reply("<b>Режим тишины выключен</b>", { parse_mode: "HTML" });
    });
    bot.command("link", async (c) => {
        if (!["group", "supergroup"].includes(c.chat.type))
            return;
        try {
            const link = await c.api.exportChatInviteLink(c.chat.id);
            await c.reply(`<b>Ссылка группы</b>\n${esc(link)}`, { parse_mode: "HTML" });
        }
        catch {
            await c.reply("Не удалось получить ссылку. Проверьте право бота приглашать пользователей.");
        }
    });
}
