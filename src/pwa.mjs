export const manifest=JSON.stringify({name:'K Sports Trader',short_name:'K Trading',description:'Live sports trading and profitable settlement alerts',start_url:'/',scope:'/',display:'standalone',background_color:'#09111f',theme_color:'#09111f',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]});

export const worker=`self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{}}catch{}
  if(!['profitable-settlement','test-notification'].includes(data.type))return;
  event.waitUntil(self.registration.showNotification(data.type==='test-notification'?'K notification test':'Cha-ching · favorable settlement',{
    body:data.body||'A K trade settled profitably.',icon:'/icon-192.png',badge:'/icon-192.png',
    tag:'k-settlement-'+String(data.id||''),data:{url:'/'},renotify:true,vibrate:[120,50,120]
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.focus();return}
    await self.clients.openWindow('/');
  })());
});`;
