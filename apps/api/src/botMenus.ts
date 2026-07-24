import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { join } from "node:path";
import { config } from "./config.js";
import { db } from "./db.js";
import { allow, Permission } from "./security.js";
import { esc } from "./utils.js";

type Flow =
  | { kind: "plugin"; step: "idea" | "version" | "core" | "java"; idea?: string; version?: string; core?: string }
  | { kind: "post"; step: "text" | "buttons"; groupId: string; text?: string }
  | { kind: "rules"; step: "text"; groupId: string }
  | { kind: "reminder"; step: "text" | "interval"; groupId: string; text?: string };

const flows = new Map<string, Flow>();
const key = (c: Context) => `${c.chat?.id}:${c.from?.id}`;
const banner = () => new InputFile(join(process.cwd(), "apps", "api", "assets", "ravvo-banner.png"));

const mainKeyboard = () =>
  new InlineKeyboard()
    .text("📣 СОЗДАТЬ ПОСТ", "menu:post")
    .text("📜 ИЗМЕНИТЬ ПРАВИЛА", "menu:rules")
    .row()
    .text("⏰ НАПОМИНАНИЯ", "menu:reminder")
    .text("🛡 МОДЕРАЦИЯ", "menu:moderation")
    .row()
    .text("🧩 ЗАКАЗАТЬ JAVA-ПЛАГИН", "plugin:start")
    .row()
    .text("📚 ВСЕ КОМАНДЫ", "menu:commands");

export async function sendMainMenu(c: Context) {
  const caption =
    "🛡️ <b>RAVVO COMMUNITY CONTROL</b>\n" +
    "━━━━━━━━━━━━━━━━━━━━\n\n" +
    "Управление группой, публикации, правила,\n" +
    "напоминания и модерация — прямо в Telegram.\n\n" +
    "👇 <b>ВЫБЕРИТЕ НУЖНОЕ ДЕЙСТВИЕ</b>\n\n" +
    "<i>Официальный бот Ravvo</i>";
  try {
    await c.replyWithPhoto(banner(), { caption, parse_mode: "HTML", reply_markup: mainKeyboard() });
  } catch {
    await c.reply(caption, { parse_mode: "HTML", reply_markup: mainKeyboard() });
  }
}

async function denied(c: Context) {
  await c.reply("⛔ <b>ДОСТУП ЗАПРЕЩЁН</b>\n\nЭта функция доступна только назначенным администраторам Ravvo.", {
    parse_mode: "HTML",
  });
}

async function chooseGroup(c: Context, action: "post" | "rules" | "reminder", permission: Permission) {
  if (!c.from || !c.chat) return;
  if (c.chat.type === "group" || c.chat.type === "supergroup") {
    if (!(await allow(String(c.chat.id), String(c.from.id), permission))) return denied(c);
    return beginAdminFlow(c, action, String(c.chat.id));
  }
  if (String(c.from.id) !== config.ADMIN_TELEGRAM_ID) return denied(c);
  const groups = await db.group.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 40 });
  if (!groups.length) {
    return c.reply("📭 <b>ГРУППЫ НЕ НАЙДЕНЫ</b>\n\nСначала добавьте бота в группу и отправьте там /start.", {
      parse_mode: "HTML",
    });
  }
  const keyboard = new InlineKeyboard();
  for (const group of groups) keyboard.text(`💬 ${group.title}`, `select:${action}:${group.id}`).row();
  await c.reply("🏘 <b>ВЫБЕРИТЕ ГРУППУ</b>\n\nКуда применить действие?", {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function beginAdminFlow(c: Context, action: "post" | "rules" | "reminder", groupId: string) {
  if (action === "post") {
    flows.set(key(c), { kind: "post", step: "text", groupId });
    return c.reply(
      "📣 <b>НОВЫЙ ПОСТ</b>\n━━━━━━━━━━━━━━━━━━━━\n\nОтправьте текст публикации.\nМожно использовать несколько строк и эмодзи.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
  }
  if (action === "rules") {
    flows.set(key(c), { kind: "rules", step: "text", groupId });
    return c.reply(
      "📜 <b>НОВЫЕ ПРАВИЛА</b>\n━━━━━━━━━━━━━━━━━━━━\n\nОтправьте полный текст правил одним сообщением.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
  }
  flows.set(key(c), { kind: "reminder", step: "text", groupId });
  return c.reply(
    "⏰ <b>НОВОЕ НАПОМИНАНИЕ</b>\n━━━━━━━━━━━━━━━━━━━━\n\nСначала отправьте текст, который бот будет публиковать.\n\n/cancel — отменить",
    { parse_mode: "HTML" },
  );
}

function parseButtons(text: string) {
  if (text.trim() === "-") return [];
  const buttons: { text: string; url: string }[] = [];
  for (const line of text.split("\n")) {
    const [label, url] = line.split("|").map((part) => part.trim());
    if (!label || !/^https?:\/\/\S+$/i.test(url ?? "")) return null;
    buttons.push({ text: label.slice(0, 50), url });
  }
  return buttons.slice(0, 12);
}

export function installBotMenus(bot: Bot) {
  bot.command("menu", sendMainMenu);
  bot.command("order", async (c) => {
    flows.set(key(c), { kind: "plugin", step: "idea" });
    await c.reply(
      "🧩 <b>ЗАКАЗ JAVA-ПЛАГИНА</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<b>Шаг 1 из 4</b>\nПодробно опишите идею и функции плагина.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
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
    await c.reply(
      "🧩 <b>ЗАКАЗ JAVA-ПЛАГИНА</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<b>Шаг 1 из 4</b>\nПодробно опишите идею и функции плагина.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
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
  bot.callbackQuery(/^select:(post|rules|reminder):(-?\d+)$/, async (c) => {
    await c.answerCallbackQuery();
    if (!c.from || String(c.from.id) !== config.ADMIN_TELEGRAM_ID) return denied(c);
    await beginAdminFlow(c, c.match[1] as "post" | "rules" | "reminder", c.match[2]);
  });
  bot.callbackQuery("menu:moderation", async (c) => {
    await c.answerCallbackQuery();
    await c.reply(
      "🛡 <b>ЦЕНТР МОДЕРАЦИИ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Команды используйте в группе ответом на сообщение:\n\n" +
        "🔨 <code>/ban 15m причина</code>\n" +
        "🔇 <code>/mute 1h причина</code>\n" +
        "🔊 <code>/unmute</code>\n" +
        "🚪 <code>/kick причина</code>\n" +
        "🗑 <code>/delete</code>\n" +
        "⚠️ <code>/warn причина</code>\n" +
        "✅ <code>/unwarn</code>\n\n" +
        "<i>Права проверяются автоматически</i>",
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("◀️ ГЛАВНОЕ МЕНЮ", "menu:home") },
    );
  });
  bot.callbackQuery("menu:commands", async (c) => {
    await c.answerCallbackQuery();
    await c.reply(
      "📚 <b>КОМАНДЫ RAVVO</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
        "/menu — главное меню\n/order — заказать Java-плагин\n/rules — показать правила\n/report — пожаловаться\n/announce — публикация\n/setrules — изменить правила\n" +
        "/ban · /mute · /unmute · /kick\n/delete · /warn · /unwarn\n/role give|remove — управление ролями\n\n" +
        "<i>Бот принадлежит Ravvo</i>",
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("◀️ ГЛАВНОЕ МЕНЮ", "menu:home") },
    );
  });
  bot.callbackQuery(/^request:(accept|reject):(\d+)$/, async (c) => {
    if (!c.from || String(c.from.id) !== config.ADMIN_TELEGRAM_ID) {
      return c.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
    }
    const accepted = c.match[1] === "accept";
    const userId = Number(c.match[2]);
    await c.answerCallbackQuery({ text: accepted ? "Заявка принята" : "Заявка отклонена" });
    await c.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(accepted ? "✅ ПРИНЯТО" : "❌ ОТКЛОНЕНО", "done") });
    await bot.api
      .sendMessage(
        userId,
        accepted
          ? "✅ <b>ВАША ЗАЯВКА ПРИНЯТА</b>\n\nАдминистратор Ravvo рассмотрел идею и принял заказ."
          : "❌ <b>ЗАЯВКА НЕ ПРИНЯТА</b>\n\nАдминистратор Ravvo рассмотрел ваш запрос.",
        { parse_mode: "HTML" },
      )
      .catch(() => {});
  });
  bot.callbackQuery("done", (c) => c.answerCallbackQuery());

  bot.on("message:text", async (c) => {
    const flow = flows.get(key(c));
    if (!flow || c.message.text.startsWith("/")) return;
    const text = c.message.text.trim();
    if (!text) return;

    if (flow.kind === "plugin") {
      if (flow.step === "idea") {
        flow.idea = text;
        flow.step = "version";
        return c.reply("🎮 <b>ШАГ 2 ИЗ 4</b>\n\nУкажите версию Minecraft.\nНапример: <code>1.20.1</code>", { parse_mode: "HTML" });
      }
      if (flow.step === "version") {
        flow.version = text;
        flow.step = "core";
        return c.reply("⚙️ <b>ШАГ 3 ИЗ 4</b>\n\nУкажите ядро сервера.\nНапример: <code>Paper, Spigot, Purpur</code>", {
          parse_mode: "HTML",
        });
      }
      if (flow.step === "core") {
        flow.core = text;
        flow.step = "java";
        return c.reply("☕ <b>ШАГ 4 ИЗ 4</b>\n\nУкажите версию Java.\nНапример: <code>Java 17</code> или <code>Java 21</code>", {
          parse_mode: "HTML",
        });
      }
      flows.delete(key(c));
      const user = c.from;
      const username = user.username ? `@${user.username}` : "не указан";
      const card =
        "🚨 <b>НОВЫЙ ЗАКАЗ JAVA-ПЛАГИНА</b>\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        `👤 <b>Заказчик:</b> <a href="tg://user?id=${user.id}">${esc([user.first_name, user.last_name].filter(Boolean).join(" "))}</a>\n` +
        `🔗 <b>Username:</b> ${esc(username)}\n` +
        `🆔 <b>Telegram ID:</b> <code>${user.id}</code>\n\n` +
        `🎮 <b>Minecraft:</b> ${esc(flow.version ?? "—")}\n` +
        `⚙️ <b>Ядро:</b> ${esc(flow.core ?? "—")}\n` +
        `☕ <b>Java:</b> ${esc(text)}\n\n` +
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
      return c.reply(
        "✅ <b>ЗАЯВКА ОТПРАВЛЕНА</b>\n━━━━━━━━━━━━━━━━━━━━\n\nАдминистратор Ravvo получил всю информацию и ваш профиль.\nОжидайте решения.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }

    if (flow.kind === "rules") {
      await db.group.update({ where: { id: flow.groupId }, data: { rules: text } });
      flows.delete(key(c));
      await bot.api.sendMessage(Number(flow.groupId), `📜 <b>ПРАВИЛА ГРУППЫ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${esc(text)}\n\n<i>Ravvo</i>`, {
        parse_mode: "HTML",
      });
      return c.reply("✅ <b>ПРАВИЛА СОХРАНЕНЫ И ОПУБЛИКОВАНЫ</b>", { parse_mode: "HTML" });
    }

    if (flow.kind === "post" && flow.step === "text") {
      flow.text = text;
      flow.step = "buttons";
      return c.reply(
        "🔘 <b>КНОПКИ ДЛЯ ПОСТА</b>\n━━━━━━━━━━━━━━━━━━━━\n\n" +
          "Каждая кнопка с новой строки:\n<code>Название | https://ссылка.ru</code>\n\n" +
          "Можно добавить до 12 кнопок.\nОтправьте <code>-</code>, если кнопки не нужны.",
        { parse_mode: "HTML" },
      );
    }
    if (flow.kind === "post") {
      const buttons = parseButtons(text);
      if (!buttons) {
        return c.reply("⚠️ Неверный формат. Используйте:\n<code>Название | https://ссылка.ru</code>", { parse_mode: "HTML" });
      }
      const keyboard = new InlineKeyboard();
      buttons.forEach((button, index) => {
        keyboard.url(button.text, button.url);
        if (index % 2 === 1) keyboard.row();
      });
      const sent = await bot.api.sendMessage(
        Number(flow.groupId),
        `📣 <b>ОБЪЯВЛЕНИЕ</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${esc(flow.text ?? "")}\n\n<i>Опубликовано через Ravvo</i>`,
        { parse_mode: "HTML", reply_markup: keyboard },
      );
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
      return c.reply(
        "⏱ <b>ИНТЕРВАЛ</b>\n\nЧерез сколько часов повторять сообщение?\nНапример: <code>1</code>, <code>6</code>, <code>24</code>",
        { parse_mode: "HTML" },
      );
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
