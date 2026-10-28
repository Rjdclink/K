import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE='k_session';
const LIFE_SECONDS=7*24*60*60;
const same=(a,b)=>{
  const x=Buffer.from(String(a)),y=Buffer.from(String(b));
  return x.length===y.length&&timingSafeEqual(x,y);
};

export function checkCredentials(user,password,secret){
  return Boolean(secret)&&same(user,'rjdc')&&same(password,secret);
}

function signature(payload,secret){return createHmac('sha256',secret).update(payload).digest('base64url')}

export function sessionCookie(secret,now=Date.now(),secure=true){
  if(!secret)throw Error('Dashboard password is not configured');
  const payload=`${Math.floor(now/1000)+LIFE_SECONDS}.${randomBytes(18).toString('base64url')}`;
  return `${COOKIE}=${payload}.${signature(payload,secret)}; Path=/; Max-Age=${LIFE_SECONDS}; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;
}

export function sessionValid(cookieHeader,secret,now=Date.now()){
  if(!secret||!cookieHeader)return false;
  const value=String(cookieHeader).split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if(!value||value.length>160)return false;
  const parts=value.match(/^(\d{10})\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/);
  if(!parts)return false;
  const expires=Number(parts[1]);
  if(expires<=Math.floor(now/1000)||expires>Math.floor(now/1000)+LIFE_SECONDS)return false;
  const payload=`${parts[1]}.${parts[2]}`;
  return same(parts[3],signature(payload,secret));
}

export function authorized(req,secret){
  if(!secret)return false;
  const header=req.headers.get('authorization')||'';
  if(header.startsWith('Basic ')){
    try{
      const decoded=Buffer.from(header.slice(6),'base64').toString('utf8');
      const colon=decoded.indexOf(':');
      if(colon>=0&&checkCredentials(decoded.slice(0,colon),decoded.slice(colon+1),secret))return true;
    }catch{}
  }
  return sessionValid(req.headers.get('cookie'),secret);
}

export function loginPage(error=false){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · K</title><meta name="theme-color" content="#09111f"><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#eef4ff;background:#09111f}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 80% 0%,#1a586455,transparent 50%),#09111f}.card{width:min(100%,390px);background:linear-gradient(145deg,#17273a,#101e2f);border:1px solid #ffffff1d;border-radius:24px;padding:32px;box-shadow:0 20px 70px #0005}.logo{height:48px;width:48px;display:grid;place-items:center;color:#7debd1;background:#65e8c41a;border:1px solid #65e8c46a;border-radius:13px;font-size:25px;font-weight:700}h1{font-size:28px;letter-spacing:-.04em;margin:24px 0 6px}p{color:#94aabd;margin:0 0 26px;font-size:14px;line-height:1.5}label{display:block;color:#b7c9d7;margin:17px 0 7px;font-size:13px}input{display:block;width:100%;font:inherit;color:#eef4ff;background:#0b1828;border:1px solid #ffffff38;border-radius:11px;padding:13px 14px}input:focus{outline:2px solid #70e7cc;outline-offset:1px}button{display:block;width:100%;font:700 15px system-ui;color:#082017;background:#78e9cf;border:0;border-radius:11px;padding:14px;margin-top:26px;cursor:pointer}.error{color:#ff8d9a;margin:0 0 16px}
</style></head><body><main class="card"><div class="logo">K</div><h1>Welcome back</h1><p>Sign in to your sports trading dashboard.</p>${error?'<p class="error" role="alert">Username or password was not accepted.</p>':''}<form method="post" action="/login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></main></body></html>`}
