import { InlineKeyboard, InputFile } from "grammy";
import { join } from "node:path";
import { config } from "./config.js";
import { db } from "./db.js";
import { getSettings, saveSettings } from "./groupSettings.js";
import { allow } from "./security.js";
import { esc } from "./utils.js";
const flows = new Map();
const key = (c) => `${c.chat?.id}:${c.from?.id}`;
const banner = () => new InputFile(join(process.cwd(), "apps", "api", "assets", "ravvo-banner.png"));
const mainKeyboard = () => new InlineKeyboard()
    .text("📣 СОЗДАТЬ ПОСТ", "menu:post")
    .text("📜 ИЗМЕНИТЬ ПРАВИЛА", "menu:rules")
    .row()
    .text("⏰ НАПОМИНАНИЯ", "menu:reminder")
    .text("🛡 МОДЕРАЦИЯ", "menu:moderation")
    .row()
    .text("👋 ПРИВЕТСТВИЕ И ПРОЩАНИЕ", "menu:greeting")
    .row()
    .text("🧩 ЗАКАЗАТЬ JAVA-ПЛАГИН", "plugin:start")
    .row()
    .text("📚 ВСЕ КОМАНДЫ", "menu:commands");
export async function sendMainMenu(c) {
    const caption = "🛡️ <b>RAVVO COMMUNITY CONTROL</b>\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Управление группой, публикации, правила,\n" +
        "напоминания и модерация — прямо в Telegram.\n\n" +
        "👇 <b>ВЫБЕРИТЕ НУЖНОЕ ДЕЙСТВИЕ</b>\n\n" +
        "<i>Официальный бот Ravvo</i>";
    try {
        await c.replyWithPhoto(banner(), { caption, parse_mode: "HTML", reply_markup: mainKeyboard() });
    }
    catch {
        await c.reply(caption, { parse_mode: "HTML", reply_markup: mainKeyboard() });
    }
}
async function denied(c) {
    await c.reply("⛔ <b>ДОСТУП ЗАПРЕЩЁН</b>\n\nЭта функция доступна только назначенным администраторам Ravvo.", {
        parse_mode: "HTML",
    });
}
async function chooseGroup(c, action, permission) {
    if (!c.from || !c.chat)
        return;
    if (c.chat.type === "group" || c.chat.type === "supergroup") {
        if (!(await allow(String(c.chat.id), String(c.from.id), permission)))
            return denied(c);
        return beginAdminFlow(c, action, String(c.chat.id));
    }
    if (String(c.from.id) !== config.ADMIN_TELEGRAM_ID)
        return denied(c);
    const groups = await db.group.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 40 });
    if (!groups.length) {
        return c.reply("📭 <b>ГРУППЫ НЕ НАЙДЕНЫ</b>\n\nСначала добавьте бота в группу и отправьте там /start.", {
            parse_mode: "HTML",
        });
    }
    const keyboard = new InlineKeyboard();
    for (const group of groups)
        keyboard.text(`💬 ${group.title}`, `select:${action}:${group.id}`).row();
    await c.reply("🏘 <b>ВЫБЕРИТЕ ГРУППУ</b>\n\nКуда применить действие?", {
        parse_mode: "HTML",
        reply_markup: keyboard,
    });
}
async function beginAdminFlow(c, action, groupId) {
    if (action === "post") {
        flows.set(key(c), { kind: "post", step: "text", groupId });
        return c.reply("📣 <b>НОВЫЙ ПОСТ</b>\n━━━━━━━━━━━━━━━━━━━━\n\nОтправьте текст публикации.\nМожно использовать несколько строк и эмодзи.\n\n/cancel — отменить", { parse_mode: "HTML" });
    }
    if (action === "rules") {
        flows.set(key(c), { kind: "rules", step: "text", groupId });
        return c.reply("📜 <b>НОВЫЕ ПРАВИЛА</b>\n━━━━━━━━━━━━━━━━━━━━\n\nОтправьте полный текст правил одним сообщением.\n\n/cancel — отменить", { parse_mode: "HTML" });
    }
    if (action === "greeting") {
        flows.set(key(c), { kind: "greeting", step: "welcome", groupId });
        return c.reply("👋 <b>ТЕКСТ ПРИВЕТСТВИЯ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
            "Отправьте сообщение для новых участников.\n\n" +
            "Переменные:\n<code>{user}</code> — имя участника\n<code>{group}</code> — название группы\n\n" +
            "Отправьте <code>-</code>, чтобы отключить приветствие.", { parse_mode: "HTML" });
    }
    flows.set(key(c), { kind: "reminder", step: "text", groupId });
    return c.reply("⏰ <b>НОВОЕ НАПОМИНАНИЕ</b>\n━━━━━━━━━━━━━━━━━━━━\n\nСначала отправьте текст, который бот будет публиковать.\n\n/cancel — отменить", { parse_mode: "HTML" });
}
function parseButtons(text) {
    if (text.trim() === "-")
        return [];
    const buttons = [];
    for (const line of text.split("\n")) {
        const [label, url] = line.split("|").map((part) => part.trim());
        if (!label || !/^https?:\/\/\S+$/i.test(url ?? ""))
            return null;
        buttons.push({ text: label.slice(0, 50), url });
    }
    return buttons.slice(0, 12);
}
async function sendDecision(bot, c, userId, accepted, reason) {
    const title = accepted ? "✅ ВАША ЗАЯВКА ПРИНЯТА" : "❌ ВАША ЗАЯВКА ОТКЛОНЕНА";
    const body = accepted
        ? "Администратор Ravvo принял ваш заказ и сможет связаться с вами."
        : "Администратор Ravvo рассмотрел заказ и пока не может его принять.";
    const reasonBlock = reason ? `\n\n💬 <b>Комментарий администратора:</b>\n${esc(reason)}` : "";
    await bot.api
        .sendMessage(userId, `${title}\n━━━━━━━━━━━━━━━━━━━━\n\n${body}${reasonBlock}\n\n<i>Ravvo</i>`, { parse_mode: "HTML" })
        .catch(() => { });
    await c.reply(`📨 <b>РЕШЕНИЕ ОТПРАВЛЕНО ПОКУПАТЕЛЮ</b>${reason ? "\n\nКомментарий также отправлен." : ""}`, {
        parse_mode: "HTML",
    });
}
export function installBotMenus(bot) {
    bot.command("menu", sendMainMenu);
    bot.command("order", async (c) => {
        flows.set(key(c), { kind: "plugin", step: "idea" });
        await c.reply("🧩 <b>ЗАКАЗ JAVA-ПЛАГИНА</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<b>Шаг 1 из 5</b>\nПодробно опишите идею и функции плагина.\n\n/cancel — отменить", { parse_mode: "HTML" });
    });
    bot.command("cancel", async (c) => {
        flows.delete(key(c));
        await c.reply("❌ <b>ДЕЙСТВИЕ ОТМЕНЕНО</b>", { parse_mode: "HTML", reply_markup: mainKeyboard() });
    });
    bot.callbackQuery("menu:home", async (c) => {
        await c.answerCallbackQuery();
        await sendMainMenu(c);
    });
    bot.callbackQuery("plugin:start", async (c) => {
        await c.answerCallbackQuery();
        flows.set(key(c), { kind: "plugin", step: "idea" });
        await c.reply("🧩 <b>ЗАКАЗ JAVA-ПЛАГИНА</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<b>Шаг 1 из 5</b>\nПодробно опишите идею и функции плагина.\n\n/cancel — отменить", { parse_mode: "HTML" });
    });
    bot.callbackQuery("menu:post", async (c) => {
        await c.answerCallbackQuery();
        await chooseGroup(c, "post", "ANNOUNCE");
    });
    bot.callbackQuery("menu:rules", async (c) => {
        await c.answerCallbackQuery();
        await chooseGroup(c, "rules", "RULES_MANAGE");
    });
    bot.callbackQuery("menu:reminder", async (c) => {
        await c.answerCallbackQuery();
        await chooseGroup(c, "reminder", "ANNOUNCE");
    });
    bot.callbackQuery("menu:greeting", async (c) => {
        await c.answerCallbackQuery();
        await chooseGroup(c, "greeting", "RULES_MANAGE");
    });
    bot.callbackQuery(/^select:(post|rules|reminder|greeting):(-?\d+)$/, async (c) => {
        await c.answerCallbackQuery();
        if (!c.from || String(c.from.id) !== config.ADMIN_TELEGRAM_ID)
            return denied(c);
        await beginAdminFlow(c, c.match[1], c.match[2]);
    });
    bot.callbackQuery("menu:moderation", async (c) => {
        await c.answerCallbackQuery();
        await c.reply("🛡 <b>ЦЕНТР МОДЕРАЦИИ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
            "Команды используйте в группе ответом на сообщение:\n\n" +
            "🔨 <code>/ban 15m причина</code>\n" +
            "🔇 <code>/mute 1h причина</code>\n" +
            "🔊 <code>/unmute</code>\n" +
            "🚪 <code>/kick причина</code>\n" +
            "🗑 <code>/delete</code>\n" +
            "⚠️ <code>/warn причина</code>\n" +
            "✅ <code>/unwarn</code>\n\n" +
            "<i>Права проверяются автоматически</i>", { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("◀️ ГЛАВНОЕ МЕНЮ", "menu:home") });
    });
    bot.callbackQuery("menu:commands", async (c) => {
        await c.answerCallbackQuery();
        await c.reply("📚 <b>КОМАНДЫ RAVVO</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
            "/menu — главное меню\n/order — заказать Java-плагин\n/rules — показать правила\n/report — пожаловаться\n/announce — публикация\n/setrules — изменить правила\n" +
            "/ban · /mute · /unmute · /kick\n/delete · /warn · /unwarn\n/role give|remove — управление ролями\n\n" +
            "<i>Бот принадлежит Ravvo</i>", { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("◀️ ГЛАВНОЕ МЕНЮ", "menu:home") });
    });
    bot.callbackQuery(/^request:(accept|reject):(\d+)$/, async (c) => {
        if (!c.from || String(c.from.id) !== config.ADMIN_TELEGRAM_ID) {
            return c.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
        }
        const accepted = c.match[1] === "accept";
        const userId = Number(c.match[2]);
        flows.set(key(c), { kind: "decision", step: "reason", userId, accepted });
        await c.answerCallbackQuery({ text: accepted ? "Вы выбрали: принять" : "Вы выбрали: отклонить" });
        await c.editMessageReplyMarkup({
            reply_markup: new InlineKeyboard().text(accepted ? "✅ ВЫБРАНО: ПРИНЯТЬ" : "❌ ВЫБРАНО: ОТКЛОНИТЬ", "done"),
        });
        await c.reply(`${accepted ? "✅" : "❌"} <b>${accepted ? "ПРИНЯТИЕ ЗАКАЗА" : "ОТКЛОНЕНИЕ ЗАКАЗА"}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
            "Напишите причину или комментарий для покупателя.", {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard().text("⏭ ПРОПУСТИТЬ ПРИЧИНУ", "reason:skip"),
        });
    });
    bot.callbackQuery("reason:skip", async (c) => {
        const flow = flows.get(key(c));
        if (!flow || flow.kind !== "decision" || String(c.from.id) !== config.ADMIN_TELEGRAM_ID) {
            return c.answerCallbackQuery({ text: "Нет ожидающего решения", show_alert: true });
        }
        await c.answerCallbackQuery();
        flows.delete(key(c));
        await sendDecision(bot, c, flow.userId, flow.accepted);
    });
    bot.callbackQuery("done", (c) => c.answerCallbackQuery());
    bot.on("message:text", async (c) => {
        const flow = flows.get(key(c));
        if (!flow || c.message.text.startsWith("/"))
            return;
        const text = c.message.text.trim();
        if (!text)
            return;
        if (flow.kind === "plugin") {
            if (flow.step === "idea") {
                flow.idea = text;
                flow.step = "version";
                return c.reply("🎮 <b>ШАГ 2 ИЗ 5</b>\n\nУкажите версию Minecraft.\nНапример: <code>1.20.1</code>", { parse_mode: "HTML" });
            }
            if (flow.step === "version") {
                flow.version = text;
                flow.step = "core";
                return c.reply("⚙️ <b>ШАГ 3 ИЗ 5</b>\n\nУкажите ядро сервера.\nНапример: <code>Paper, Spigot, Purpur</code>", {
                    parse_mode: "HTML",
                });
            }
            if (flow.step === "core") {
                flow.core = text;
                flow.step = "java";
                return c.reply("☕ <b>ШАГ 4 ИЗ 5</b>\n\nУкажите версию Java.\nНапример: <code>Java 17</code> или <code>Java 21</code>", {
                    parse_mode: "HTML",
                });
            }
            if (flow.step === "java") {
                flow.java = text;
                flow.step = "budget";
                return c.reply("💰 <b>ШАГ 5 ИЗ 5</b>\n\nСколько вы готовы заплатить за разработку?\nНапример: <code>5 000 ₽</code>, <code>50 $</code> или «предложите цену».", { parse_mode: "HTML" });
            }
            flows.delete(key(c));
            const user = c.from;
            const username = user.username ? `@${user.username}` : "не указан";
            const card = "🚨 <b>НОВЫЙ ЗАКАЗ JAVA-ПЛАГИНА</b>\n" +
                "━━━━━━━━━━━━━━━━━━━━\n\n" +
                `👤 <b>Заказчик:</b> <a href="tg://user?id=${user.id}">${esc([user.first_name, user.last_name].filter(Boolean).join(" "))}</a>\n` +
                `🔗 <b>Username:</b> ${esc(username)}\n` +
                `🆔 <b>Telegram ID:</b> <code>${user.id}</code>\n\n` +
                `🎮 <b>Minecraft:</b> ${esc(flow.version ?? "—")}\n` +
                `⚙️ <b>Ядро:</b> ${esc(flow.core ?? "—")}\n` +
                `☕ <b>Java:</b> ${esc(flow.java ?? "—")}\n` +
                `💰 <b>Бюджет:</b> ${esc(text)}\n\n` +
                `💡 <b>ИДЕЯ И ФУНКЦИИ</b>\n${esc(flow.idea ?? "—")}\n\n` +
                "<i>Заявка получена через Ravvo</i>";
            if (config.ADMIN_TELEGRAM_ID) {
                await bot.api.sendMessage(Number(config.ADMIN_TELEGRAM_ID), card, {
                    parse_mode: "HTML",
                    reply_markup: new InlineKeyboard()
                        .text("✅ ПРИНЯТЬ", `request:accept:${user.id}`)
                        .text("❌ ОТКЛОНИТЬ", `request:reject:${user.id}`),
                });
            }
            return c.reply("✅ <b>ЗАЯВКА ОТПРАВЛЕНА</b>\n━━━━━━━━━━━━━━━━━━━━\n\nАдминистратор Ravvo получил всю информацию и ваш профиль.\nОжидайте решения.", { parse_mode: "HTML", reply_markup: mainKeyboard() });
        }
        if (flow.kind === "decision") {
            flows.delete(key(c));
            return sendDecision(bot, c, flow.userId, flow.accepted, text);
        }
        if (flow.kind === "rules") {
            await db.group.update({ where: { id: flow.groupId }, data: { rules: text } });
            flows.delete(key(c));
            await bot.api.sendMessage(Number(flow.groupId), `📜 <b>ПРАВИЛА ГРУППЫ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${esc(text)}\n\n<i>Ravvo</i>`, {
                parse_mode: "HTML",
            });
            return c.reply("✅ <b>ПРАВИЛА СОХРАНЕНЫ И ОПУБЛИКОВАНЫ</b>", { parse_mode: "HTML" });
        }
        if (flow.kind === "greeting" && flow.step === "welcome") {
            flow.welcomeText = text;
            flow.step = "goodbye";
            return c.reply("👋 <b>ТЕКСТ ПРОЩАНИЯ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
                "Теперь отправьте сообщение для участника, который покидает группу.\n\n" +
                "Можно использовать <code>{user}</code> и <code>{group}</code>.\n" +
                "Отправьте <code>-</code>, чтобы отключить прощание.", { parse_mode: "HTML" });
        }
        if (flow.kind === "greeting") {
            const current = await getSettings(flow.groupId);
            await saveSettings(flow.groupId, {
                ...current,
                welcomeEnabled: flow.welcomeText !== "-",
                welcomeText: flow.welcomeText === "-" ? current.welcomeText : flow.welcomeText,
                goodbyeEnabled: text !== "-",
                goodbyeText: text === "-" ? current.goodbyeText : text,
            });
            flows.delete(key(c));
            return c.reply("✅ <b>ПРИВЕТСТВИЕ И ПРОЩАНИЕ СОХРАНЕНЫ</b>\n\n" +
                `${flow.welcomeText === "-" ? "⚪ Приветствие выключено" : "🟢 Приветствие включено"}\n` +
                `${text === "-" ? "⚪ Прощание выключено" : "🟢 Прощание включено"}`, { parse_mode: "HTML", reply_markup: mainKeyboard() });
        }
        if (flow.kind === "post" && flow.step === "text") {
            flow.text = text;
            flow.step = "buttons";
            return c.reply("🔘 <b>КНОПКИ ДЛЯ ПОСТА</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
                "Каждая кнопка с новой строки:\n<code>Название | https://ссылка.ru</code>\n\n" +
                "Можно добавить до 12 кнопок.\nОтправьте <code>-</code>, если кнопки не нужны.", { parse_mode: "HTML" });
        }
        if (flow.kind === "post") {
            const buttons = parseButtons(text);
            if (!buttons) {
                return c.reply("⚠️ Неверный формат. Используйте:\n<code>Название | https://ссылка.ru</code>", { parse_mode: "HTML" });
            }
            const keyboard = new InlineKeyboard();
            buttons.forEach((button, index) => {
                keyboard.url(button.text, button.url);
                if (index % 2 === 1)
                    keyboard.row();
            });
            const sent = await bot.api.sendMessage(Number(flow.groupId), `📣 <b>ОБЪЯВЛЕНИЕ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${esc(flow.text ?? "")}\n\n<i>Опубликовано через Ravvo</i>`, { parse_mode: "HTML", reply_markup: keyboard });
            await db.announcement.create({
                data: {
                    groupId: flow.groupId,
                    authorId: String(c.from.id),
                    text: flow.text ?? "",
                    messageId: String(sent.message_id),
                    buttons: JSON.stringify(buttons),
                },
            });
            flows.delete(key(c));
            return c.reply("✅ <b>ПОСТ ОПУБЛИКОВАН</b>", { parse_mode: "HTML", reply_markup: mainKeyboard() });
        }
        if (flow.kind === "reminder" && flow.step === "text") {
            flow.text = text;
            flow.step = "interval";
            return c.reply("⏱ <b>ИНТЕРВАЛ</b>\n\nЧерез сколько часов повторять сообщение?\nНапример: <code>1</code>, <code>6</code>, <code>24</code>", { parse_mode: "HTML" });
        }
        if (flow.kind === "reminder") {
            const hours = Number(text.replace(",", "."));
            if (!Number.isFinite(hours) || hours < 0.25 || hours > 8760) {
                return c.reply("⚠️ Введите число от <code>0.25</code> до <code>8760</code>.", { parse_mode: "HTML" });
            }
            await db.reminder.create({
                data: {
                    groupId: flow.groupId,
                    text: flow.text ?? "",
                    intervalHours: hours,
                    nextRunAt: new Date(Date.now() + hours * 3_600_000),
                },
            });
            flows.delete(key(c));
            return c.reply(`✅ <b>НАПОМИНАНИЕ СОЗДАНО</b>\n\nИнтервал: каждые ${hours} ч.`, {
                parse_mode: "HTML",
                reply_markup: mainKeyboard(),
            });
        }
    });
}
