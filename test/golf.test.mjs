import test from 'node:test';import assert from 'node:assert/strict';
import {golfState,golfSignal,golfAgreement} from '../src/golf.mjs';
import {gameTimeLabel} from '../src/discovery.mjs';
const m={id:'g',type:'golf_tournament',title:'Example Open',start_date:'2026-10-29T00:00:00Z',details:{tour:'pga',main_game_event_ticker:'KXPGATOUR-X'}};
const board=[{competitor_id:'a',total_score:-13,current_round_thru:18},{competitor_id:'b',total_score:-7,current_round_thru:17}];
const state=b=>golfState(m,{milestone_id:'g',details:{status:'inprogress',current_round:4,leaderboard:b}});
const market={status:'active',event_ticker:'KXPGATOUR-X',custom_strike:{golf_competitor:'a'},yes_sub_title:'Player One',rules_primary:'If Player One wins the Example Open, Yes.'};
test('golf six stroke final round lead requires every contender within one hole',()=>{
 assert.equal(state(board).remainingSeconds,NaN);
 assert.equal(gameTimeLabel(state(board)),'Round 4 · 17–18 holes completed');
 assert.equal(golfSignal(state(board),market)?.fraction,.10);
 assert.equal(golfSignal(state([{...board[0],total_score:-12},board[1]]),market),null,'five strokes no longer qualifies');
 assert.equal(golfSignal(state([board[0],{...board[1],current_round_thru:16}]),market),null);
 assert.equal(golfSignal(state([{...board[0],total_score:-11},board[1]]),market),null);
 assert.equal(golfSignal(state(board.map(p=>({...p,current_round_thru:18}))),market),null);
 assert.equal(golfSignal({...state(board),period:3},market),null);
});
test('golf independent board must agree on every named golfer and holes completed',()=>{
 const event={markets:[market,{custom_strike:{golf_competitor:'b'},yes_sub_title:'Player Two'}]};
 const data={events:[{name:'Example Open',date:m.start_date,league:{slug:'pga'},competitions:[{status:{period:4,type:{state:'in'}},competitors:board.map((p,i)=>({athlete:{displayName:i?'Player Two':'Player One'},score:{displayValue:String(p.total_score)},status:{period:4,thru:p.current_round_thru}}))}]}]};
 assert.equal(golfAgreement(data,state(board),m,event),true);
 data.events[0].competitions[0].competitors[1].status.thru=16;
 assert.equal(golfAgreement(data,state(board),m,event),false);
});

