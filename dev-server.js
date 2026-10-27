const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const contentTypes = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
http.createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  if(/^\/api\/(page|chapters|verse|timing)$/.test(url.pathname)) {
    const route = url.pathname.split('/')[2];
    res.status = code => {res.statusCode=code;return res;};
    res.json = data=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    req.query = Object.fromEntries(url.searchParams.entries());
    try { await require(`./api/${route}.js`)(req,res); }catch(e){console.error(e);res.status(500).json({error:'حدث خطأ في الخادم'});}
    return;
  }
  let file = path.resolve(root, '.' + (url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.statusCode=404;return res.end('Not found');}
  res.setHeader('Content-Type', contentTypes[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000,()=>console.log('http://localhost:'+(process.env.PORT||3000)));
