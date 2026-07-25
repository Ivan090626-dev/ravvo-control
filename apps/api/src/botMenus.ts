import { Bot, Context, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { db } from "./db.js";
import { getSettings, GroupSettings, saveSettings } from "./groupSettings.js";
import { allow, Permission } from "./security.js";
import { esc } from "./utils.js";
import { sendSticker, sticker } from "./brand.js";

type Flow =
  | { kind: "plugin"; step: "idea" | "version" | "core" | "java" | "budget"; idea?: string; version?: string; core?: string; java?: string }
  | { kind: "post"; step: "text" | "buttons"; groupId: string; text?: string }
  | { kind: "rules"; step: "text"; groupId: string }
  | { kind: "reminder"; step: "text" | "interval"; groupId: string; text?: string }
  | { kind: "greeting"; step: "welcome" | "goodbye"; groupId: string; welcomeText?: string }
  | { kind: "protection"; step: "words" | "domains" | "warnLimit"; groupId: string }
  | { kind: "decision"; step: "reason"; userId: number; accepted: boolean };

const flows = new Map<string, Flow>();
const key = (c: Context) => `${c.chat?.id}:${c.from?.id}`;
const mainKeyboard = (addUrl?: string) => {
  const keyboard = new InlineKeyboard();
  if (addUrl) keyboard.url("Добавить Ravvo в группу", addUrl).row();
  return keyboard
    .text("Создать пост", "menu:post")
    .text("Правила", "menu:rules")
    .row()
    .text("Напоминания", "menu:reminder")
    .text("Модерация", "menu:moderation")
    .row()
    .text("Защита группы", "menu:protection")
    .row()
    .text("Приветствие и прощание", "menu:greeting")
    .row()
    .text("Заказать Java-плагин", "plugin:start")
    .row()
    .text("Команды", "menu:commands");
};

export async function sendMainMenu(c: Context) {
  const me = await c.api.getMe();
  const permissions = [
    "change_info",
    "delete_messages",
    "restrict_members",
    "invite_users",
    "pin_messages",
    "manage_video_chats",
    "manage_topics",
  ].join("+");
  const addUrl = `https://t.me/${me.username}?startgroup=ravvo&admin=${permissions}`;
  const caption =
    "👋 <b>Приветствую!</b>\n\n" +
    "Ravvo — виртуальный модератор вашей группы. Я помогу управлять участниками, публикациями, правилами и автоматической защитой сообщества.\n\n" +
    "❗️ <b>Какие команды доступны?</b>\n" +
    "Отправьте /help, чтобы открыть полный список возможностей.\n\n" +
    "Чтобы подключить Ravvo, нажмите кнопку ниже и выберите группу, в которой у вас есть право добавлять администраторов.";
  await c.reply(caption, { parse_mode: "HTML", reply_markup: mainKeyboard(addUrl) });
}

async function denied(c: Context) {
  await c.reply("<b>Нет доступа</b>\n\nФункция доступна администраторам.", {
    parse_mode: "HTML",
  });
}

type GroupAction = "post" | "rules" | "reminder" | "greeting" | "protection";

async function chooseGroup(c: Context, action: GroupAction, permission: Permission) {
  if (!c.from || !c.chat) return;
  if (c.chat.type === "group" || c.chat.type === "supergroup") {
    if (!(await allow(String(c.chat.id), String(c.from.id), permission))) return denied(c);
    return beginAdminFlow(c, action, String(c.chat.id));
  }
  let groups;
  if (String(c.from.id) === config.ADMIN_TELEGRAM_ID) {
    groups = await db.group.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 40 });
  } else {
    const memberships = await db.member.findMany({
      where: { telegramId: String(c.from.id), group: { active: true } },
      include: { group: true, roles: { include: { role: true } } },
      take: 80,
    });
    groups = memberships
      .filter((member) => {
        if (member.nativeAdmin) return true;
        return member.roles.some((item) => {
          try {
            return (JSON.parse(item.role.permissions) as string[]).includes(permission);
          } catch {
            return false;
          }
        });
      })
      .map((member) => member.group)
      .slice(0, 40);
  }
  if (!groups.length) {
    return c.reply("<b>Группы не найдены</b>\n\nДобавьте бота в группу и отправьте /start.", {
      parse_mode: "HTML",
    });
  }
  const keyboard = new InlineKeyboard();
  for (const group of groups) keyboard.text(`💬 ${group.title}`, `select:${action}:${group.id}`).row();
  await c.reply("<b>Выберите группу</b>", {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function beginAdminFlow(c: Context, action: GroupAction, groupId: string) {
  if (action === "post") {
    flows.set(key(c), { kind: "post", step: "text", groupId });
    return c.reply(
      "<b>Новый пост</b>\n\nОтправьте текст.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
  }
  if (action === "rules") {
    flows.set(key(c), { kind: "rules", step: "text", groupId });
    return c.reply(
      "<b>Правила</b>\n\nОтправьте новый текст одним сообщением.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
  }
  if (action === "greeting") {
    flows.set(key(c), { kind: "greeting", step: "welcome", groupId });
    return c.reply(
      "<b>Приветствие</b>\n\n" +
        "Отправьте текст для новых участников.\n" +
        "<code>{user}</code> — имя · <code>{group}</code> — группа\n\n" +
        "<code>-</code> — отключить",
      { parse_mode: "HTML" },
    );
  }
  if (action === "protection") return showProtection(c, groupId);
  flows.set(key(c), { kind: "reminder", step: "text", groupId });
  return c.reply(
    "<b>Новое напоминание</b>\n\nОтправьте текст.\n\n/cancel — отменить",
    { parse_mode: "HTML" },
  );
}

const protectionFields: Record<string, keyof Pick<GroupSettings, "captchaEnabled" | "antiLinks" | "badWordsEnabled" | "antiFlood" | "antiCaps" | "blockForwards" | "blockMedia">> = {
  captcha: "captchaEnabled",
  links: "antiLinks",
  words: "badWordsEnabled",
  flood: "antiFlood",
  caps: "antiCaps",
  forwards: "blockForwards",
  media: "blockMedia",
};

const state = (enabled: boolean) => (enabled ? "Включено" : "Выключено");
const actionName = (action: GroupSettings["warnAction"]) => ({ mute: "Мут на 1 час", kick: "Исключение", ban: "Блокировка" })[action];

async function showProtection(c: Context, groupId: string) {
  const settings = await getSettings(groupId);
  const keyboard = new InlineKeyboard()
    .text(`CAPTCHA · ${state(settings.captchaEnabled)}`, `protect:toggle:captcha:${groupId}`)
    .row()
    .text(`Ссылки · ${state(settings.antiLinks)}`, `protect:toggle:links:${groupId}`)
    .text(`Стоп-слова · ${state(settings.badWordsEnabled)}`, `protect:toggle:words:${groupId}`)
    .row()
    .text(`Антифлуд · ${state(settings.antiFlood)}`, `protect:toggle:flood:${groupId}`)
    .text(`Капс · ${state(settings.antiCaps)}`, `protect:toggle:caps:${groupId}`)
    .row()
    .text(`Пересылки · ${state(settings.blockForwards)}`, `protect:toggle:forwards:${groupId}`)
    .text(`Медиа · ${state(settings.blockMedia)}`, `protect:toggle:media:${groupId}`)
    .row()
    .text("Изменить запрещённые слова", `protect:edit:words:${groupId}`)
    .row()
    .text("Изменить разрешённые домены", `protect:edit:domains:${groupId}`)
    .row()
    .text(`Лимит варнов · ${settings.warnLimit}`, `protect:edit:warnLimit:${groupId}`)
    .row()
    .text(`Наказание · ${actionName(settings.warnAction)}`, `protect:action:${groupId}`)
    .row()
    .text("Вернуться в меню", "menu:home");
  await c.reply(
    "<b>Защита группы</b>\n\n" +
      "Настройте автоматическую модерацию. Изменения применяются сразу.\n\n" +
      "<b>CAPTCHA</b> ограничивает новых участников до подтверждения входа.\n" +
      "<b>Ссылки</b> удаляет публикации с неразрешёнными адресами.\n" +
      "<b>Стоп-слова</b> удаляет сообщение и выдаёт участнику предупреждение.\n" +
      "<b>Антифлуд</b> останавливает частые повторные сообщения.\n" +
      "<b>Капс</b> ограничивает сообщения с большим количеством заглавных букв.\n" +
      "<b>Пересылки и медиа</b> позволяют полностью запретить соответствующий контент.",
    { parse_mode: "HTML", reply_markup: keyboard },
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

async function sendDecision(bot: Bot, c: Context, userId: number, accepted: boolean, reason?: string) {
  const title = accepted ? "✅ <b>Заказ принят</b>" : "❌ <b>Заказ отклонён</b>";
  const body = accepted
    ? "Администратор Ravvo принял ваш заказ и сможет связаться с вами."
    : "Администратор Ravvo рассмотрел заказ и пока не может его принять.";
  const reasonBlock = reason ? `\n\n💬 <b>Комментарий администратора:</b>\n${esc(reason)}` : "";
  await bot.api
    .sendSticker(userId, sticker("success"))
    .catch(() => {});
  await bot.api
    .sendMessage(userId, `${title}\n\n${body}${reasonBlock}`, { parse_mode: "HTML" })
    .catch(() => {});
  await c.reply(`<b>Решение отправлено</b>${reason ? "\n\nКомментарий добавлен." : ""}`, {
    parse_mode: "HTML",
  });
}

export function installBotMenus(bot: Bot) {
  bot.command("menu", sendMainMenu);
  bot.command("order", async (c) => {
    flows.set(key(c), { kind: "plugin", step: "idea" });
    await c.reply(
      "<b>Заказ Java-плагина · 1/5</b>\n\nОпишите идею и функции.\n\n/cancel — отменить",
      { parse_mode: "HTML" },
    );
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
    await c.reply(
      "<b>Заказ Java-плагина · 1/5</b>\n\nОпишите идею и функции.\n\n/cancel — отменить",
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
  bot.callbackQuery("menu:greeting", async (c) => {
    await c.answerCallbackQuery();
    await chooseGroup(c, "greeting", "RULES_MANAGE");
  });
  bot.callbackQuery("menu:protection", async (c) => {
    await c.answerCallbackQuery();
    await chooseGroup(c, "protection", "MUTE");
  });
  bot.callbackQuery(/^select:(post|rules|reminder|greeting|protection):(-?\d+)$/, async (c) => {
    await c.answerCallbackQuery();
    const action = c.match[1] as GroupAction;
    const groupId = c.match[2];
    const permission: Permission =
      action === "post" || action === "reminder" ? "ANNOUNCE" : action === "rules" || action === "greeting" ? "RULES_MANAGE" : "MUTE";
    if (!c.from || (String(c.from.id) !== config.ADMIN_TELEGRAM_ID && !(await allow(groupId, String(c.from.id), permission)))) {
      return denied(c);
    }
    await beginAdminFlow(c, action, groupId);
  });
  bot.callbackQuery(/^protect:toggle:(captcha|links|words|flood|caps|forwards|media):(-?\d+)$/, async (c) => {
    await c.answerCallbackQuery();
    const groupId = c.match[2];
    if (!c.from || (String(c.from.id) !== config.ADMIN_TELEGRAM_ID && !(await allow(groupId, String(c.from.id), "MUTE")))) return denied(c);
    const current = await getSettings(groupId);
    const field = protectionFields[c.match[1]];
    await saveSettings(groupId, { ...current, [field]: !current[field] });
    await c.reply(`<b>Настройка изменена</b>\n\n${state(!current[field])}. Новые сообщения будут проверяться по обновлённым правилам.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Открыть защиту", `protect:open:${groupId}`),
    });
  });
  bot.callbackQuery(/^protect:open:(-?\d+)$/, async (c) => {
    await c.answerCallbackQuery();
    await showProtection(c, c.match[1]);
  });
  bot.callbackQuery(/^protect:action:(-?\d+)$/, async (c) => {
    await c.answerCallbackQuery();
    const groupId = c.match[1];
    if (!c.from || (String(c.from.id) !== config.ADMIN_TELEGRAM_ID && !(await allow(groupId, String(c.from.id), "MUTE")))) return denied(c);
    const current = await getSettings(groupId);
    const next: GroupSettings["warnAction"] = current.warnAction === "mute" ? "kick" : current.warnAction === "kick" ? "ban" : "mute";
    await saveSettings(groupId, { ...current, warnAction: next });
    await c.reply(`<b>Наказание изменено</b>\n\nПосле достижения лимита: ${actionName(next)}.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Открыть защиту", `protect:open:${groupId}`),
    });
  });
  bot.callbackQuery(/^protect:edit:(words|domains|warnLimit):(-?\d+)$/, async (c) => {
    await c.answerCallbackQuery();
    const groupId = c.match[2];
    if (!c.from || (String(c.from.id) !== config.ADMIN_TELEGRAM_ID && !(await allow(groupId, String(c.from.id), "MUTE")))) return denied(c);
    const field = c.match[1] as "words" | "domains" | "warnLimit";
    flows.set(key(c), { kind: "protection", step: field, groupId });
    const prompt =
      field === "words"
        ? "<b>Запрещённые слова</b>\n\nОтправьте слова и фразы через запятую. Регистр не учитывается.\n\nПри совпадении сообщение будет удалено, а участник получит варн.\nОтправьте <code>-</code>, чтобы очистить список."
        : field === "domains"
          ? "<b>Разрешённые домены</b>\n\nОтправьте домены через запятую, например:\n<code>youtube.com, github.com, ravvo.ru</code>\n\nСсылки на эти сайты не будут удаляться. <code>-</code> — очистить список."
          : "<b>Лимит предупреждений</b>\n\nВведите число от 1 до 20.\n\nПосле достижения лимита бот применит автоматическое наказание, выбранное в настройках группы.";
    await c.reply(prompt, { parse_mode: "HTML" });
  });
  bot.callbackQuery("menu:moderation", async (c) => {
    await c.answerCallbackQuery();
    await sendSticker(c, "moderator");
    await c.reply(
      "<b>Модерация</b>\n\n" +
        "Используйте команду ответом на сообщение.\n\n" +
        "<code>/ban 15m причина</code>\n" +
        "<code>/mute 1h причина</code>\n" +
        "<code>/unmute</code>\n" +
        "<code>/kick причина</code>\n" +
        "<code>/delete</code>\n" +
        "<code>/warn причина</code>\n" +
        "<code>/unwarn</code>",
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Назад", "menu:home") },
    );
  });
  bot.callbackQuery("menu:commands", async (c) => {
    await c.answerCallbackQuery();
    await c.reply(
      "<b>Команды</b>\n\n" +
        "<b>Управление</b>\n/menu · /settings · /reload\n\n" +
        "<b>Модерация</b>\n/ban · /unban · /kick · /mute · /unmute\n/warn · /unwarn · /warns · /delete · /purge\n\n" +
        "<b>Публикации</b>\n/announce · /send · /pin · /unpinall\n\n" +
        "<b>Информация</b>\n/info · /staff · /rules · /link",
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Назад", "menu:home") },
    );
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
      reply_markup: new InlineKeyboard().text(accepted ? "✓ Принять" : "× Отклонить", "done"),
    });
    await c.reply(
      `<b>${accepted ? "Принять заказ" : "Отклонить заказ"}</b>\n\nНапишите комментарий покупателю.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("Пропустить комментарий", "reason:skip"),
      },
    );
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
    if (!flow || c.message.text.startsWith("/")) return;
    const text = c.message.text.trim();
    if (!text) return;

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
        return c.reply(
          "💳 <b>Ваш бюджет · 5/5</b>\n\n" +
            "Какую цену вы готовы заплатить?\n" +
            "Например: <code>5 000 ₽</code>, <code>50 $</code> или <code>Предложите цену</code>.",
          { parse_mode: "HTML" },
        );
      }
      flows.delete(key(c));
      const user = c.from;
      const username = user.username ? `@${user.username}` : "не указан";
      const card =
        "<b>Новый заказ</b>\n\n" +
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
      await sendSticker(c, "success");
      return c.reply(
        "<b>Заказ отправлен</b>\n\nВы получите уведомление после решения.",
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }

    if (flow.kind === "decision") {
      flows.delete(key(c));
      return sendDecision(bot, c, flow.userId, flow.accepted, text);
    }

    if (flow.kind === "protection") {
      const current = await getSettings(flow.groupId);
      if (flow.step === "warnLimit") {
        const limit = Number(text);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
          return c.reply("<b>Неверное значение</b>\n\nВведите целое число от 1 до 20.", { parse_mode: "HTML" });
        }
        await saveSettings(flow.groupId, { ...current, warnLimit: limit });
        flows.delete(key(c));
        return c.reply(
          `<b>Лимит сохранён</b>\n\nПосле ${limit} предупреждений бот автоматически применит выбранное наказание.`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Открыть защиту", `protect:open:${flow.groupId}`) },
        );
      }
      const values =
        text === "-"
          ? []
          : [...new Set(text.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
      if (flow.step === "words") {
        await saveSettings(flow.groupId, { ...current, badWords: values, badWordsEnabled: values.length > 0 });
        flows.delete(key(c));
        return c.reply(
          `<b>Список стоп-слов обновлён</b>\n\nФраз в списке: ${values.length}.\n${values.length ? "Фильтр включён. Совпадения будут удаляться, участники получат варн." : "Фильтр выключен, потому что список пуст."}`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Открыть защиту", `protect:open:${flow.groupId}`) },
        );
      }
      await saveSettings(flow.groupId, { ...current, allowedDomains: values });
      flows.delete(key(c));
      return c.reply(
        `<b>Разрешённые домены обновлены</b>\n\nДоменов в списке: ${values.length}.\nЗащита ссылок не будет удалять ссылки на эти адреса.`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Открыть защиту", `protect:open:${flow.groupId}`) },
      );
    }

    if (flow.kind === "rules") {
      await db.group.update({ where: { id: flow.groupId }, data: { rules: text } });
      flows.delete(key(c));
      await bot.api.sendMessage(Number(flow.groupId), `<b>Правила сообщества</b>\n\n${esc(text)}`, {
        parse_mode: "HTML",
      });
      await sendSticker(c, "success");
      return c.reply("<b>Правила опубликованы</b>", { parse_mode: "HTML" });
    }

    if (flow.kind === "greeting" && flow.step === "welcome") {
      flow.welcomeText = text;
      flow.step = "goodbye";
      return c.reply(
        "<b>Прощание</b>\n\n" +
          "Отправьте текст.\n" +
          "<code>{user}</code> — имя · <code>{group}</code> — группа\n\n" +
          "<code>-</code> — отключить",
        { parse_mode: "HTML" },
      );
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
      return c.reply(
        "<b>Настройки сохранены</b>\n\n" +
          `${flow.welcomeText === "-" ? "Приветствие выключено" : "Приветствие включено"}\n` +
          `${text === "-" ? "Прощание выключено" : "Прощание включено"}`,
        { parse_mode: "HTML", reply_markup: mainKeyboard() },
      );
    }

    if (flow.kind === "post" && flow.step === "text") {
      flow.text = text;
      flow.step = "buttons";
      return c.reply(
        "<b>Кнопки</b>\n\n" +
          "Одна кнопка на строку:\n<code>Название | https://ссылка.ru</code>\n\n" +
          "До 12 кнопок. <code>-</code> — без кнопок.",
        { parse_mode: "HTML" },
      );
    }
    if (flow.kind === "post") {
      const buttons = parseButtons(text);
      if (!buttons) {
        return c.reply("<b>Не удалось прочитать кнопки</b>\n\nИспользуйте:\n<code>Название | https://ссылка.ru</code>", { parse_mode: "HTML" });
      }
      const keyboard = new InlineKeyboard();
      buttons.forEach((button, index) => {
        keyboard.url(button.text, button.url);
        if (index % 2 === 1) keyboard.row();
      });
      const sent = await bot.api.sendMessage(
        Number(flow.groupId),
        `<b>Объявление</b>\n\n${esc(flow.text ?? "")}`,
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
      await sendSticker(c, "success");
      return c.reply("<b>Пост опубликован</b>", { parse_mode: "HTML", reply_markup: mainKeyboard() });
    }

    if (flow.kind === "reminder" && flow.step === "text") {
      flow.text = text;
      flow.step = "interval";
      return c.reply(
        "<b>Интервал</b>\n\nЧерез сколько часов повторять сообщение?\nНапример: <code>1</code>, <code>6</code>, <code>24</code>",
        { parse_mode: "HTML" },
      );
    }
    if (flow.kind === "reminder") {
      const hours = Number(text.replace(",", "."));
      if (!Number.isFinite(hours) || hours < 0.25 || hours > 8760) {
        return c.reply("<b>Неверный интервал</b>\n\nВведите число от <code>0.25</code> до <code>8760</code>.", { parse_mode: "HTML" });
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
      await sendSticker(c, "success");
      return c.reply(`<b>Напоминание создано</b>\n\nКаждые ${hours} ч.`, {
        parse_mode: "HTML",
        reply_markup: mainKeyboard(),
      });
    }
  });
}
