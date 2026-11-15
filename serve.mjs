import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const files = new Map([["/","text/html"],["/index.html","text/html"],["/dashboard.js","text/javascript"],["/style.css","text/css"],["/public.css","text/css"],["/snapshot.json","application/json"]]);
export async function handle(req,res,dir=new URL("./dist/",import.meta.url)) {
  res.setHeader("X-Content-Type-Options","nosniff");
  const path = req.url?.split("?")[0];
  if (!["GET","HEAD"].includes(req.method) || !files.has(path)) {
    res.writeHead(404).end(); return;
  }
  try {
    const body = await readFile(new URL(path === "/" ? "index.html" : path.slice(1),dir));
    res.writeHead(200,{"Content-Type":files.get(path)+"; charset=utf-8"}).end(req.method==="HEAD"?undefined:body);
  } catch {res.writeHead(503).end("Build the demo first.");}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const server = createServer((req,res)=>handle(req,res));
  server.listen(Number(process.env.PORT ?? 4173),"127.0.0.1",()=>console.log("Preview: http://127.0.0.1:"+server.address().port));
}
