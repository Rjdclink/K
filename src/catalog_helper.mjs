export async function supplementalCatalog(url,{expiresAt='',fetcher=fetch,now=Date.now(),timeoutMs=1500}={}){
  if(!url||!expiresAt||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now)return null;
  try{
    const target=new URL('/catalog',url);
    if(target.protocol!=='https:'||target.username||target.password)return null;
    const response=await fetcher(target,{headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)return null;
    const limit=8*1024*1024,chunks=[];let size=0;
    if(Number(response.headers.get('content-length'))>limit)return null;
    const reader=response.body.getReader();
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();return null}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    const data=JSON.parse(new TextDecoder().decode(bytes)),at=Date.parse(data.generatedAt||'');
    if(data.protocol!==1||data.kind!=='supplemental-catalog'||!Number.isFinite(at)||at>now+5000||now-at>=60000||
      JSON.stringify(data.categories)!==JSON.stringify(['Sports','Esports'])||!Array.isArray(data.milestones)||
      data.milestones.length===0||data.milestones.length>10000||
      data.milestones.some(m=>!m||typeof m.id!=='string'||m.id.length<1||m.id.length>200||typeof m.type!=='string'))return null;
    return data;
  }catch{return null}
}
