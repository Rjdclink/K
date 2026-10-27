import http from 'node:http';
import app from './src/index.mjs';
http.createServer(async(req,res)=>{const body=[];for await(const chunk of req)body.push(chunk);const response=await app.fetch(new Request('http://localhost:8787'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(body),duplex:'half'}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}).listen(8787,()=>console.log('http://localhost:8787'));
