import crypto from "node:crypto";
import { config } from "./config.js";
export type TelegramUser={id:number;first_name:string;last_name?:string;username?:string};
export function verifyTelegramInitData(value:string){
  const params=new URLSearchParams(value),hash=params.get("hash");
  if(!hash)return null;
  params.delete("hash");
  const data=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHmac("sha256","WebAppData").update(config.BOT_TOKEN).digest();
  const expected=crypto.createHmac("sha256",secret).update(data).digest("hex");
  if(expected.length!==hash.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(hash)))return null;
  const authDate=Number(params.get("auth_date"));
  if(!authDate||Date.now()/1000-authDate>86400)return null;
  try{return JSON.parse(params.get("user")||"") as TelegramUser}catch{return null}
}
