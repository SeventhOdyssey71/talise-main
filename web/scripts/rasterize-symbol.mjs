// Rasterize Talise's symbol.svg to PNG for email use. Email clients
// (Gmail, Outlook) don't render SVG reliably; PNG hosted at a public
// URL is the universal fallback. Re-fills the SVG with the brand
// accent (#79D96C) before rasterizing.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, "..");

const svg = await fs.readFile(path.join(WEB, "public/symbol.svg"), "utf8");
const tinted = svg.replace(/fill="[^"]*"/g, 'fill="#79D96C"');

for (const [w, h, name] of [
  [48, 44, "symbol.png"],
  [96, 88, "symbol@2x.png"],
]) {
  const resvg = new Resvg(tinted, {
    fitTo: { mode: "width", value: w },
    background: "rgba(0,0,0,0)",
  });
  const png = resvg.render().asPng();
  await fs.writeFile(path.join(WEB, "public", name), png);
  console.log("wrote", name, `${w}x${h}`);
}
