import { Context, InputFile } from "grammy";
import { join } from "node:path";

export type RavvoSticker = "welcome" | "success" | "moderator";

export function sticker(name: RavvoSticker) {
  return new InputFile(join(process.cwd(), "apps", "api", "assets", "stickers", `${name}.webp`));
}

export async function sendSticker(c: Context, name: RavvoSticker) {
  try {
    await c.replyWithSticker(sticker(name));
  } catch {
    // Text remains available if Telegram rejects a local sticker upload.
  }
}
