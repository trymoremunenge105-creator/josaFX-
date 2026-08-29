const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.JOZAFX_ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error("Missing JOZAFX_ADMIN_TOKEN environment variable.");
  process.exit(1);
}

app.use(express.json({limit:"32kb"}));

const db = new Database(process.env.JOZAFX_DB || path.join(__dirname, "josafx.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT UNIQUE NOT NULL,
  client_name TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
`);

function admin(req,res,next){
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN))) {
    return res.status(401).json({ok:false,error:"Unauthorized"});
  }
  next();
}

function makeKey(){
  const b = crypto.randomBytes(10).toString("hex").toUpperCase();
  return `JFX-${b.slice(0,4)}-${b.slice(4,8)}-${b.slice(8,12)}-${b.slice(12,16)}`;
}

app.get("/health",(req,res)=>res.json({ok:true,service:"JozaFX License API"}));

app.post("/api/license/verify",(req,res)=>{
  const key = String(req.body?.license_key || "").trim().toUpperCase();
  if(!key) return res.status(400).json({ok:false,valid:false,error:"License key required"});
  const row = db.prepare("SELECT * FROM licenses WHERE license_key=?").get(key);
  if(!row) return res.json({ok:true,valid:false,reason:"not_found"});
  const expired = Date.parse(row.expires_at) <= Date.now();
  const valid = row.status === "active" && !expired;
  res.json({ok:true,valid,reason: valid ? "active" : (row.status !== "active" ? "revoked" : "expired"),
    client_name: row.client_name, expires_at: row.expires_at});
});

app.post("/api/admin/licenses", admin, (req,res)=>{
  const days = Math.max(1, Math.min(3650, Number(req.body?.days || 30)));
  const client = String(req.body?.client_name || "").slice(0,100);
  const now = new Date();
  const expiry = new Date(now.getTime() + days*86400000);
  let key;
  for(let i=0;i<5;i++){
    try{
      key=makeKey();
      db.prepare("INSERT INTO licenses (license_key,client_name,created_at,expires_at,status) VALUES (?,?,?,?,?)")
        .run(key,client,now.toISOString(),expiry.toISOString(),"active");
      break;
    }catch(e){ if(i===4) throw e; }
  }
  res.json({ok:true,license:{license_key:key,client_name:client,created_at:now.toISOString(),expires_at:expiry.toISOString(),status:"active"}});
});

app.get("/api/admin/licenses", admin, (req,res)=>{
  const rows=db.prepare("SELECT id,license_key,client_name,created_at,expires_at,status FROM licenses ORDER BY id DESC").all();
  res.json({ok:true,licenses:rows});
});

app.post("/api/admin/licenses/:key/revoke", admin, (req,res)=>{
  const key=String(req.params.key||"").toUpperCase();
  const info=db.prepare("UPDATE licenses SET status='revoked' WHERE license_key=?").run(key);
  res.json({ok:true,changed:info.changes});
});

app.post("/api/admin/licenses/:key/activate", admin, (req,res)=>{
  const key=String(req.params.key||"").toUpperCase();
  const info=db.prepare("UPDATE licenses SET status='active' WHERE license_key=?").run(key);
  res.json({ok:true,changed:info.changes});
});

app.get('/', (req, res) => {
  res.send('JOSA-FX API is running smoothly!');
});

app.listen(PORT,()=>console.log(`JozaFX License API listening on port ${PORT}`));
