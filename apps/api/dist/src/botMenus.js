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
    .text("Создать пост", "menu:post")
    .text("Правила", "menu:rules")
    .row()
    .text("Напоминания", "menu:reminder")
    .text("Модерация", "menu:moderation")
    .row()
    .text("Приветствие и прощание", "menu:greeting")
    .row()
    .text("Заказать Java-плагин", "plugin:start")
    .row()
    .text("Команды", "menu:commands");
export async function sendMainMenu(c) {
    const caption = "<b>Ravvo</b>\n\n" +
        "Управление группой прямо в Telegram.\n" +
        "Выберите действие.";
    try {
        await c.replyWithPhoto(banner(), { caption, parse_mode: "HTML", reply_markup: mainKeyboard() });
    }
    catch {
        await c.reply(caption, { parse_mode: "HTML", reply_markup: mainKeyboard() });
    }
}
async function denied(c) {
    await c.reply("<b>Нет доступа</b>\n\nФункция доступна администраторам.", {
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
        return c.reply("<b>Группы не найдены</b>\n\nДобавьте бота в группу и отправьте /start.", {
            parse_mode: "HTML",
        });
    }
    const keyboard = new InlineKeyboard();
    for (const group of groups)
        keyboard.text(`💬 ${group.title}`, `select:${action}:${group.id}`).row();
    await c.reply("<b>Выберите группу</b>", {
        parse_mode: "HTML",
        reply_markup: keyboard,
    });
}
async function beginAdminFlow(c, action, groupId) {
    if (action === "post") {
        flows.set(key(c), { kind: "post", step: "text", groupId });
        return c.reply("<b>Новый пост</b>\n\nОтправьте текст.\n\n/cancel — отменить", { parse_mode: "HTML" });
    }
    if (action === "rules") {
        flows.set(key(c), { kind: "rules", step: "text", groupId });
        return c.reply("<b>Правила</b>\n\nОтправьте новый текст одним сообщением.\n\n/cancel — отменить", { parse_mode: "HTML" });
    }
    if (action === "greeting") {
        flows.set(key(c), { kind: "greeting", step: "welcome", groupId });
        return c.reply("<b>Приветствие</b>\n\n" +
            "Отправьте текст для новых участников.\n" +
            "<code>{user}</code> — имя · <code>{group}</code> — группа\n\n" +
            "<code>-</code> — отключить", { parse_mode: "HTML" });
    }
    flows.set(key(c), { kind: "reminder", step: "text", groupId });
    return c.reply("<b>Новое напоминание</b>\n\nОтправьте текст.\n\n/cancel — отменить", { parse_mode: "HTML" });
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
    const title = accepted ? "✅ <b>Заказ принят</b>" : "❌ <b>Заказ отклонён</b>";
    const body = accepted
        ? "Администратор Ravvo принял ваш заказ и сможет связаться с вами."
        : "Администратор Ravvo рассмотрел заказ и пока не может его принять.";
    const reasonBlock = reason ? `\n\n💬 <b>Комментарий администратора:</b>\n${esc(reason)}` : "";
    await bot.api
        .sendMessage(userId, `${title}\n\n${body}${reasonBlock}`, { parse_mode: "HTML" })
        .catch(() => { });
    await c.reply(`<b>Решение отправлено</b>${reason ? "\n\nКомментарий добавлен." : ""}`, {
        parse_mode: "HTML",
    });
}
export function installBotMenus(bot) {
    bot.command("menu", sendMainMenu);
    bot.command("order", async (c) => {
        flows.set(key(c), { kind: "plugin", step: "idea" });
        await c.reply("<b>Заказ Java-плагина · 1/5</b>\n\nОпишите идею и функции.\n\n/cancel — отменить", { parse_mode: "HTML" });
    });
    bot.command("cancel", async (c) => {
        flows.delete(key(c));
        await c.reply("<b>Отменено</b>", { parse_mode: "HTML", reply_markup: mainKeyboard() });
    });
    bot.callbackQuery("menu:home", async (c) => {
        await c.answerCallbackQuery();
        await sendMainMenu(c);
    });
    bot.callbackQuery("plugin:start", async (c) => {
        await c.answerCallbackQuery();
        flows.set(key(c), { kind: "plugin", step: "idea" });
        await c.reply("<b>Заказ Java-плагина · 1/5</b>\n\nОпишите идею и функции.\n\n/cancel — отменить", { parse_mode: "HTML" });
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
        await c.reply(`<b>${accepted ? "Принять заказ" : "Отклонить заказ"}</b>\n\nНапишите комментарий покупателю.`, {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard().text("Пропустить комментарий", "reason:skip"),
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
                return c.reply("<b>Minecraft · 2/5</b>\n\nУкажите версию. Например: <code>1.20.1</code>", { parse_mode: "HTML" });
            }
            if (flow.step === "version") {
                flow.version = text;
                flow.step = "core";
                return c.reply("<b>Ядро · 3/5</b>\n\nНапример: <code>Paper, Spigot, Purpur</code>", {
                    parse_mode: "HTML",
                });
            }
            if (flow.step === "core") {
                flow.core = text;
                flow.step = "java";
                return c.reply("<b>Java · 4/5</b>\n\nНапример: <code>17</code> или <code>21</code>", {
                    parse_mode: "HTML",
                });
            }
            if (flow.step === "java") {
                flow.java = text;
                flow.step = "budget";
                return c.reply("💳 <b>Ваш бюджет · 5/5</b>\n\n" +
                    "Какую цену вы готовы заплатить?\n" +
                    "Например: <code>5 000 ₽</code>, <code>50 $</code> или <code>Предложите цену</code>.", { parse_mode: "HTML" });
            }
            flows.delete(key(c));
            const user = c.from;
            const username = user.username ? `@${user.username}` : "не указан";
            const card = "<b>Новый заказ</b>\n\n" +
                `<b>Клиент</b>\n<a href="tg://user?id=${user.id}">${esc([user.first_name, user.last_name].filter(Boolean).join(" "))}</a> · ${esc(username)}\n` +
                `ID <code>${user.id}</code>\n\n` +
                `<b>Проект</b>\nMinecraft ${esc(flow.version ?? "—")} · ${esc(flow.core ?? "—")} · Java ${esc(flow.java ?? "—")}\n\n` +
                `💳 <b>Цена заказчика: ${esc(text)}</b>\n\n` +
                `<b>Описание</b>\n${esc(flow.idea ?? "—")}`;
            if (config.ADMIN_TELEGRAM_ID) {
                await bot.api.sendMessage(Number(config.ADMIN_TELEGRAM_ID), card, {
                    parse_mode: "HTML",
                    reply_markup: new InlineKeyboard()
                        .text("✓ Принять", `request:accept:${user.id}`)
                        .text("× Отклонить", `request:reject:${user.id}`),
                });
            }
            return c.reply("<b>Заказ отправлен</b>\n\nВы получите уведомление после решения.", { parse_mode: "HTML", reply_markup: mainKeyboard() });
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
            return c.reply("<b>Прощание</b>\n\n" +
                "Отправьте текст.\n" +
                "<code>{user}</code> — имя · <code>{group}</code> — группа\n\n" +
                "<code>-</code> — отключить", { parse_mode: "HTML" });
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
            return c.reply("<b>Настройки сохранены</b>\n\n" +
                `${flow.welcomeText === "-" ? "Приветствие выключено" : "Приветствие включено"}\n` +
                `${text === "-" ? "Прощание выключено" : "Прощание включено"}`, { parse_mode: "HTML", reply_markup: mainKeyboard() });
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
