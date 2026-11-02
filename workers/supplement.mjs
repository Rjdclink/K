import http from 'node:http';
import {createCatalogService} from './catalog_service.mjs';
import {probeKalshi} from './probe.mjs';

const service=createCatalogService();let probe=null,probeAt=0;
const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
  if(req.method!=='GET'){res.writeHead(405);res.end('{}');return}
  try{
    const path=new URL(req.url,'http://helper.local').pathname;let result;
    if(path==='/'||path==='/health')result=service.health();
    else if(path==='/catalog')result=await service.catalog();
    else if(path==='/latency'){
      if(!probe||Date.now()-probeAt>300000){probeAt=Date.now();probe=probeKalshi().catch(error=>{probe=null;throw error})}
      result=await probe;
    }else{res.writeHead(404);res.end('{}');return}
    res.end(JSON.stringify(result));
  }catch{res.writeHead(503);res.end(JSON.stringify({error:'Public data helper temporarily unavailable'}))}
});
server.listen(Number(process.env.PORT||process.env.SERVER_PORT||3000),'0.0.0.0',()=>console.log('Supplement ready'));
const stop=()=>{service.close();server.close()};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
