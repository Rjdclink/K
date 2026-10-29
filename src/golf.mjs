const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function golfState(m,live){
 const d=live?.details||{},board=d.leaderboard||[],ranked=board.filter(p=>Number.isFinite(p.total_score)).sort((a,b)=>a.total_score-b.total_score);
 return {id:m.id,feedId:live?.milestone_id,title:m.title,type:m.type,sport:'Golf',tour:m.details?.tour,status:d.status,verifiedLive:['live','inprogress','in_progress'].includes(d.status)&&d.live_data_delayed!==true,scoreKnown:ranked.length>=2,scoreConsistent:true,periodConsistent:true,period:d.current_round,home:ranked[0]?.total_score,away:ranked[1]?.total_score,homeUnits:ranked[0]?.total_score,awayUnits:ranked[1]?.total_score,unit:'strokes',golf:{board,competitorIds:m.details?.competitor_ids||[],mainEvent:m.details?.main_game_event_ticker},observedAt:Date.parse(live?._observed_at||''),remainingSeconds:NaN,clockRunning:false};
}
export function golfSignal(game,market){
 if(!game?.golf||!game.verifiedLive||!game.scoreKnown||!['pga','lpga','euro'].includes(game.tour)||game.period!==4||!['active','open'].includes(market.status)||market.event_ticker!==game.golf.mainEvent)return null;
 const board=game.golf.board;
 if(board.length<2||board.some(p=>!Number.isFinite(p.total_score)||!Number.isInteger(p.current_round_thru)||p.current_round_thru<17||p.current_round_thru>18))return null;
 const ranked=[...board].sort((a,b)=>a.total_score-b.total_score),leader=ranked[0];
 if(ranked[1].total_score-leader.total_score<5||!board.some(p=>p.current_round_thru===17)||market.custom_strike?.golf_competitor!==leader.competitor_id||!market.yes_sub_title||!/wins/i.test(market.rules_primary||''))return null;
 return {strategy:'lead',fraction:.10,reason:`${market.yes_sub_title} leads by ${ranked[1].total_score-leader.total_score} strokes; final round, at most one hole remaining per golfer`};
}
export function golfAgreement(data,game,milestone,event){
 const matches=(data?.events||[]).filter(e=>clean(e.name)===clean(milestone.title)&&Math.abs(Date.parse(e.date)-Date.parse(milestone.start_date))<48*3600000&&e.league?.slug===game.tour);
 if(matches.length!==1)return false;
 const c=matches[0].competitions?.[0];
 if(c?.status?.period!==4||c.status.type?.state!=='in')return false;
 const players=c.competitors||[];
 if(players.length!==game.golf.board.length)return false;
 return game.golf.board.every(p=>{
  const names=[...new Set((event.markets||[]).filter(m=>m.custom_strike?.golf_competitor===p.competitor_id).map(m=>m.yes_sub_title))];
  if(names.length!==1)return false;
  const found=players.filter(a=>clean(a.athlete?.displayName)===clean(names[0]));
  if(found.length!==1)return false;
  const a=found[0],score=a.score?.displayValue==='E'?0:Number(a.score?.displayValue);
  return Number.isFinite(score)&&score===p.total_score&&a.status?.period===4&&a.status?.thru===p.current_round_thru&&!a.status?.playoff;
 });
}
export async function verifyGolf(game,milestone,event,fetcher=fetch){
 if(!game?.golf)return false;
 try{
  const r=await fetcher(`https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?region=us&lang=en&league=${encodeURIComponent(game.tour)}`,{signal:AbortSignal.timeout(7000)});
  return r.ok&&golfAgreement(await r.json(),game,milestone,event);
 }catch{return false}
}
