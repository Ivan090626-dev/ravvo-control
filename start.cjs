#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const root = __dirname;
const apiEntry = join(root, "apps", "api", "dist", "src", "index.js");

function npm(args) {
  execFileSync("npm", args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

if (!existsSync(apiEntry)) {
  npm(["run", "build"]);
}

npm(["run", "db:generate", "-w", "@sentinel/api"]);
npm(["run", "db:push", "-w", "@sentinel/api"]);

import(apiEntry).catch((error) => {
  console.error(error);
  process.exit(1);
});
