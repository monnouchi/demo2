import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.argv[2] || ".");
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
    );
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const target = path === root ? resolve(root, "index.html") : path;
    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
        }[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "0.0.0.0", () => console.log(`http://localhost:${port}`));
