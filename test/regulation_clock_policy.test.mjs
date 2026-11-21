import test from 'node:test';
import assert from 'node:assert/strict';
import {gameState,soccerRegulationSeconds,soccerLeadClock} from '../src/strategy.mjs';
import {soccerNoMarketSpec,soccerTotalNo} from '../src/soccer_total_no.mjs';

const m={id:'dewa-example',title:'Dewa United vs Persita',type:'soccer_tournament_multi_leg',start_date:'2026-11-20T10:00:00Z',
  details:{league:'Indonesia Super League',main_game_event_ticker:'KXIDNSLGAME-26NOV20DEWPER'}};
const mk=(minute,extra={})=>gameState(m,{milestone_id:m.id,_observed_at:new Date().toISOString(),
  details:{status:'inprogress',home_score:0,away_score:1,half:'2nd',time:minute,home_team_name:'Dewa United',
    away_team_name:'Persita',last_updated_ts:Date.now()/1000,...extra}});
const market={ticker:'KXIDNSLTOTAL-26NOV20DEWPER-4',event_ticker:'KXIDNSLTOTAL-26NOV20DEWPER',
  title:'Will over 3.5 goals be scored?',yes_sub_title:'Over 3.5 goals scored',
  floor_strike:3.5,strike_type:'greater',status:'active',
  rules_primary:'If over 3.5 goals are scored in the Dewa United vs Persita professional Indonesia Super League soccer game originally scheduled for Nov 20, 2026 after 90 minutes plus stoppage time (does not include extra time or penalties), then the market resolves to Yes.'};

test('soccer countdown derives strictly from regulation elapsed clock; no estimated stoppage',()=>{
  assert.equal(soccerRegulationSeconds(mk("81'")),540);
  assert.equal(soccerRegulationSeconds(mk("82'")),480);
  assert.equal(soccerRegulationSeconds(mk("82:01'")),479);
  assert.equal(soccerRegulationSeconds(mk("89:59'")),1);
  assert.equal(soccerRegulationSeconds(mk("90'")),0);
  assert.equal(soccerRegulationSeconds(mk("90+5'")),0);
  assert.equal(soccerRegulationSeconds(mk("95'")),0);
  assert.ok(Number.isNaN(soccerRegulationSeconds(mk("garbled"))));
  assert.equal(soccerRegulationSeconds(mk("81'",{match_remaining_seconds:15})),540,
    'a speculative final-whistle countdown must not replace the regulation clock');
});

test('Dewa–Persita exact total is eligible for initial 9-minute check without a feed countdown',()=>{
  assert.ok(soccerNoMarketSpec(mk("81'"),market,{beforeWindow:true}));
  assert.equal(soccerTotalNo(mk("81'"),market),null);
  assert.equal(soccerTotalNo(mk("82'"),market),null);
  assert.equal(soccerTotalNo(mk("82:01'"),market)?.total,1);
  assert.equal(soccerTotalNo(mk("89:59'"),market)?.total,1);
  assert.equal(soccerTotalNo(mk("90+5'"),market)?.total,1,'explicit live 90+ stoppage permits verified NO while the market remains open');
  assert.equal(soccerTotalNo(mk("81'",{status:'final'}),market),null);
});

test('soccer winner watch uses the same regulation window and never invents stoppage',()=>{
  assert.equal(soccerLeadClock(mk("88'"),210),true);
  assert.equal(soccerLeadClock(mk("90+2'"),210),false);
  assert.equal(soccerLeadClock(mk("95'"),900),false);
});