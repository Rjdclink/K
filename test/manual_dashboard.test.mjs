import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {page} from '../src/ui.mjs';
function harness(approved=false){
  const elements=new Map(),requests=[],confirmations=[];
  const element=()=>({children:[],style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},
    append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,querySelectorAll:()=>[]};
  const order={market_ticker:'OVER',game_title:'Rafaela vs Parana',strategy:'over',sport:'Soccer',fill_count:10};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null},setItem(){}},
    AbortSignal,URLSearchParams,setInterval(){},crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000001'},
    confirm:message=>{confirmations.push(message);return approved},fetch:async(url,options={})=>{
      requests.push([url,options]);
      if(url.startsWith('/api/buy-quote'))return {ok:true,json:async()=>({quote:{count:5,price:.9,max_cost_cents:475}})};
      if(url==='/api/buy')return {ok:true,json:async()=>({filled:5})};
      if(url.startsWith('/api/sell-quotes'))return {ok:true,json:async()=>({quotes:[]})};
      return {ok:true,json:async()=>({games:[],orders:[order],alerts:[],scan:{}})};
    }});
  vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  return {context,elements,requests,confirmations,order};
}
test('a filled contract has a dollar field and submit button; declining the second confirmation sends no buy',async()=>{
  const h=harness();await new Promise(resolve=>setImmediate(resolve));
  const render=vm.runInContext('order',h.context),card=render(h.order),form=card.children.find(c=>c.className==='invest-controls');
  assert.equal(form.children[1].type,'number');assert.equal(form.children[2].textContent,'Submit');
  form.children[1].value='10.00';form.children[1].oninput();await form.onsubmit({preventDefault(){}});
  assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0],/Invest up to \$10.00 more/);
  assert.equal(h.requests.some(([url])=>url==='/api/buy'),false);
  assert.equal(render(h.order).children.find(c=>c.className==='invest-controls').children[1].value,'10.00');
});
test('only accepting the confirmation sends the chosen dollar limit and quoted contract quantity',async()=>{
  const h=harness(true);await new Promise(resolve=>setImmediate(resolve));
  const form=vm.runInContext('order',h.context)(h.order).children.find(c=>c.className==='invest-controls');
  form.children[1].value='10';await form.onsubmit({preventDefault(){}});
  const buys=h.requests.filter(([url])=>url==='/api/buy');assert.equal(buys.length,1);
  const body=JSON.parse(buys[0][1].body);assert.equal(body.amount_cents,1000);assert.equal(body.count,5);assert.equal(body.confirmed,true);
});
test('cash-out estimates and profit/loss disappear after the unchanged thirty-second quote window',async()=>{
  const h=harness();await new Promise(resolve=>setImmediate(resolve));
  const render=vm.runInContext('order',h.context),fresh=vm.runInContext('saleQuoteFresh',h.context),now=Date.now();
  const quote={...h.order,checked_at:new Date(now).toISOString(),sell_quote:{price:.7,count:5,partial:true},sell_value_cents:345,sell_profit_cents:-100,sell_held_count:10};
  assert.equal(fresh(quote,now+30000),true);assert.equal(fresh(quote,now+30001),false);
  const card=render(quote);assert.equal(card.children.at(-1).textContent,'Sell · est. loss −$1.00');
  assert.match(card.children.at(-2).textContent,/5 of 10 shares/);assert.match(card.children.at(-2).textContent,/P\/L −\$1.00/);
  const stale=render({...quote,checked_at:new Date(now-31000).toISOString()});
  assert.equal(stale.children.at(-1).textContent,'Sell · Refresh quote');assert.doesNotMatch(stale.children.at(-2).textContent,/\$3.45|\$1.00/);
});
