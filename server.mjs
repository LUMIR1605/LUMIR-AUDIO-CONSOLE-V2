import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const urlPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = normalize(join(root, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": `${types[extname(filePath)] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`LUMIR Audio Console V2 available at http://127.0.0.1:${port}`);
});
