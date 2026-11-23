import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {isScannerExcludedSport} from '../src/discovery.mjs';
import {teamScorePosition} from '../src/strategy.mjs';
import {threatenedLead} from '../src/lead_profit_protection.mjs';
import {eligibleProfitExit,firstProfitableLeadQuote} from '../src/profit_exits.mjs';
import {sellQuote} from '../src/sell.mjs';

const source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const excerpt=source.slice(source.indexOf('async function exitComebacks('),
 source.indexOf('// A full discovery scan'));
const ticker='KXNBAGAME-20261122HOME-HOME';
const milestone={id:'legacy-held-nba',title:'Away at Home',type:'basketball_game',
 start_date:new Date().toISOString(),details:{league:'NBA',home_team_id:'home',away_team_id:'away'}};
const market={ticker,event_ticker:'KXNBAGAME-20261122HOME',
 status:'active',fractional_trading_enabled:true,
 custom_strike:{basketball_team:'home'},yes_sub_title:'Home'};
const game={id:milestone.id,feedId:milestone.id,type:milestone.type,sport:'NBA',
 verifiedLive:true,scoreKnown:true,scoreConsistent:true,periodConsistent:true,
 home:103,away:99,homeTeamId:'home',awayTeamId:'away',status:'live'};
const original={market_ticker:ticker,game_id:milestone.id,sport:'NBA',
 game_family:'basketball_game',strategy:'lead',status:'filled',reason:'Home commanded before the score narrowed',combo_legs:null};
const position={ticker,position_fp:'10',market_exposure_dollars:'8.80',fees_paid_dollars:'.10'};

async function exercise({external=game,book={yes_dollars:[['.96',10]]},
 held=position,recorded=original,fees={multiplier:1}}={}){
 const posts=[],writes=[],context=vm.createContext({
  Date,JSON,Number,Math,Map,Set,console,
  isScannerExcludedSport,teamScorePosition,threatenedLead,
  eligibleProfitExit,firstProfitableLeadQuote,sellQuote,
  ensureExitFills:async()=>{},ensureLeadProfitExitWatch:async()=>{},
  exitAtRiskNos:async()=>0,reconcilePendingExit:async()=>true,
  minimumCount:()=>.01,
  linkedEventTickers:()=>[market.event_ticker],
  currentFeeSpec:async()=>fees,externallyScoredGame:async()=>external,
  overCorrectionAffects:()=>false,comeback:()=>false,
  profitTargetAllowed:()=>false,halfPotentialProfitExitEligible:()=>false,
  oneAndHalfExitEligible:()=>false,
  randomUUID:()=> 'closed-profit-lead',liveMilestone:async()=>null,
  recordExitFill:async()=>{},invalidateBalance:async()=>{},
  pool:{query:async(sql,args=[])=>{
   if(sql.includes('SELECT DISTINCT ON (market_ticker)'))return {rows:[recorded]};
   if(sql.startsWith('SELECT market_ticker FROM exit_attempts'))return {rows:[]};
   if(sql.startsWith('SELECT market_ticker FROM lead_profit_exit_watch'))return {rows:[]};
   if(sql.includes('to_regclass'))return {rows:[{name:null}]};
   if(sql.includes('INSERT INTO lead_profit_exit_watch')){writes.push(['threat',...args]);return {rows:[],rowCount:1}};
   if(sql.includes('INSERT INTO exit_attempts'))return {rows:[{id:'closed-profit-lead'}],rowCount:1};
   return {rows:[],rowCount:1};
  }},
  kalshi:async(path,opts={})=>{
   if(opts.method==='POST'){posts.push(opts.body);return {fill_count_fp:opts.body.count,order_id:'filled'};}
   if(path.endsWith('/orderbook'))return {orderbook_fp:book};
   if(path.includes('/markets/'))return {market};
   throw Error('Unexpected mock request: '+path);
  }
 });
 vm.runInContext(excerpt,context);
 await context.exitComebacks([{milestone,state:game}],
  new Map([[market.event_ticker,{event_ticker:market.event_ticker,markets:[market]}]]),
  {market_positions:[held]});
 return {posts,writes};
}

test('held NBA commanding lead four points from a tie exits at first net profit despite banned new NBA entries',async()=>{
 assert.equal(isScannerExcludedSport(game),true);
 const {posts,writes}=await exercise();
 assert.equal(writes.length,1);
 assert.equal(posts.length,1);
 assert.equal(posts[0].reduce_only,true);
 assert.equal(posts[0].time_in_force,'immediate_or_cancel');
 assert.equal(posts[0].side,'ask');
});
test('legacy held team winner waits when independently sourced score is absent or contradicts the tieable margin',async()=>{
 assert.equal((await exercise({external:null})).posts.length,0);
 assert.equal((await exercise({external:{...game,home:105,away:99}})).posts.length,0);
});
test('legacy team winner cannot sell at a loss or with unknown acquisition fees',async()=>{
 assert.equal((await exercise({book:{yes_dollars:[['.86',10]]}})).posts.length,0);
 assert.equal((await exercise({held:{...position,fees_paid_dollars:null}})).posts.length,0);
 assert.equal((await exercise({fees:null})).posts.length,0);
});
test('multi-leg mixed-sport combinations cannot be sold as if one winner were independently verified',async()=>{
 const mixed={...original,combo_legs:[{sport:'NFL',strategy:'lead'},{sport:'NBA',strategy:'lead'}]};
 assert.equal((await exercise({recorded:mixed})).posts.length,0);
});
