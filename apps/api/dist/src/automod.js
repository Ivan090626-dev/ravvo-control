import { InlineKeyboard } from "grammy";
import { getSettings } from "./groupSettings.js";
import { esc } from "./utils.js";
const flood = new Map();
const unrestricted = { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_change_info: false, can_invite_users: true, can_pin_messages: false, can_manage_topics: false };
const restricted = { ...unrestricted, can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_invite_users: false };
function render(t, user, group) { return t.replaceAll("{user}", user).replaceAll("{group}", group); }
async function remove(c, reason) { try {
    await c.deleteMessage();
}
catch { } try {
    await c.reply(`🛡 <b>Ravvo AutoMod</b> удалил сообщение.\nПричина: ${esc(reason)}\n\n<i>Защита сообщества — Ravvo</i>`, { parse_mode: "HTML" });
}
catch { } }
export async function automod(c, next) {
    if (!c.chat || !["group", "supergroup"].includes(c.chat.type) || !c.message)
        return next();
    const groupId = String(c.chat.id), settings = await getSettings(groupId), group = "title" in c.chat && c.chat.title ? c.chat.title : "группу";
    if (c.message.new_chat_members?.length) {
        for (const u of c.message.new_chat_members) {
            if (u.is_bot)
                continue;
            const user = u.username ? `@${u.username}` : u.first_name;
            if (settings.captchaEnabled) {
                await c.api.restrictChatMember(c.chat.id, u.id, restricted, { until_date: Math.floor(Date.now() / 1000) + settings.captchaMinutes * 60 });
                const kb = new InlineKeyboard().text("✅ Я человек", `verify:${c.chat.id}:${u.id}`);
                await c.reply(`🧩 <b>Проверка Ravvo</b>\n\n${esc(user)}, подтвердите вход в течение ${settings.captchaMinutes} мин.`, { parse_mode: "HTML", reply_markup: kb });
            }
            else if (settings.welcomeEnabled)
                await c.reply(`👋 <b>Добро пожаловать!</b>\n\n${esc(render(settings.welcomeText, user, group))}\n\n<i>Сообщество управляется Ravvo</i>`, { parse_mode: "HTML" });
        }
        if (settings.deleteServiceMessages)
            try {
                await c.deleteMessage();
            }
            catch { }
        return;
    }
    if (c.message.left_chat_member) {
        if (settings.goodbyeEnabled) {
            const u = c.message.left_chat_member, user = u.username ? `@${u.username}` : u.first_name;
            await c.reply(`👋 ${esc(render(settings.goodbyeText, user, group))}\n\n<i>Ravvo</i>`, { parse_mode: "HTML" });
        }
        if (settings.deleteServiceMessages)
            try {
                await c.deleteMessage();
            }
            catch { }
        return;
    }
    if (!c.from)
        return next();
    let admin = false;
    try {
        admin = ["creator", "administrator"].includes((await c.api.getChatMember(c.chat.id, c.from.id)).status);
    }
    catch { }
    if (admin)
        return next();
    const text = c.message.text || c.message.caption || "";
    if (settings.blockForwards && c.message.forward_origin)
        return remove(c, "пересылка сообщений запрещена");
    if (settings.blockMedia && (c.message.photo || c.message.video || c.message.document || c.message.audio || c.message.voice || c.message.sticker || c.message.animation))
        return remove(c, "медиафайлы запрещены");
    if (settings.antiLinks && /(https?:\/\/|t\.me\/|www\.)/i.test(text)) {
        const allowed = settings.allowedDomains.some(d => text.toLowerCase().includes(d.toLowerCase()));
        if (!allowed)
            return remove(c, "ссылки запрещены");
    }
    if (settings.badWordsEnabled && settings.badWords.some(w => w && text.toLowerCase().includes(w.toLowerCase())))
        return remove(c, "запрещённое слово");
    if (settings.antiCaps && text.length >= 10) {
        const letters = [...text].filter(x => /[A-Za-zА-ЯЁа-яё]/.test(x)), upper = letters.filter(x => x === x.toUpperCase() && x !== x.toLowerCase()).length;
        if (letters.length && upper / letters.length * 100 >= settings.capsPercent)
            return remove(c, "слишком много заглавных букв");
    }
    if (settings.antiFlood) {
        const key = `${groupId}:${c.from.id}`, now = Date.now(), times = (flood.get(key) || []).filter(x => now - x < settings.floodSeconds * 1000);
        times.push(now);
        flood.set(key, times);
        if (times.length > settings.floodMessages) {
            await c.api.restrictChatMember(c.chat.id, c.from.id, restricted, { until_date: Math.floor(Date.now() / 1000) + 300 });
            flood.delete(key);
            return remove(c, "флуд — мут на 5 минут");
        }
    }
    return next();
}
export async function verifyCaptcha(c) { const data = c.callbackQuery?.data?.split(":"); if (!data || data[0] !== "verify")
    return; const chatId = Number(data[1]), userId = Number(data[2]); if (c.from?.id !== userId)
    return void await c.answerCallbackQuery({ text: "Эта кнопка предназначена другому участнику", show_alert: true }); await c.api.restrictChatMember(chatId, userId, unrestricted); await c.answerCallbackQuery({ text: "Проверка пройдена!" }); try {
    await c.deleteMessage();
}
catch { } }
