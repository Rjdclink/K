import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedTeamName,selectedTeamSide,selectedTennisSide} from '../src/selected_team.mjs';

test('a blank live-feed team name still highlights the exact chosen winner',()=>{
  const base={strategy:'lead',game_title:'Millwall vs Derby',market_ticker:'KXEFLCHAMPIONSHIPGAME-MILDER-MIL',
    reason:'Externally verified 20% lead:  leads 3–0 goals; second half, 3 goals ahead',
    game_signals:[{ticker:'KXEFLCHAMPIONSHIPGAME-MILDER-MIL',title:'Millwall wins'}]};
  assert.equal(selectedTeamName(base),'Millwall');
  assert.equal(selectedTeamName({...base,game_title:'Worthing vs Sutton',game_signals:[{...base.game_signals[0],title:'Sutton wins'}]}),'Sutton');
  assert.equal(selectedTeamName({...base,game_signals:[{...base.game_signals[0],title:'Derby wins by 3'}]}),'Millwall');
});
test('a rugby pick names the exact team and score side, even without a score in the entry reason',()=>{
  const order={strategy:'lead',sport:'Rugby',game_title:'Stade Francais Paris vs Stade Rochelais',
    reason:'Stade Francais Paris leads; 01:31 remaining; margin 15; Kalshi-only two score reads, 10 seconds apart'};
  assert.equal(selectedTeamName(order),'Stade Francais Paris');
  assert.equal(selectedTeamSide(order),'home');
  assert.equal(selectedTeamSide({...order,reason:'Stade Rochelais leads; 00:35 remaining; margin 2'}),'away');
});
test('the purchased tennis leader maps to a named side even after the set score changes',()=>{
  const order={strategy:'lead',sport_family:'tennis_tournament_singles',game_title:'Sonego vs Munar',
    market_ticker:'KXATPMATCH-SONMUN-SON',reason:'Tennis match-clinching set 5–4; leader serves, points 15–15',
    purchase_home:'5',purchase_away:'4',game_signals:[{ticker:'KXATPMATCH-SONMUN-SON',title:'Lorenzo Sonego wins'}]};
  assert.equal(selectedTeamName(order),'Sonego');
  assert.equal(selectedTennisSide(order),'home');
  assert.equal(selectedTennisSide({...order,purchase_home:'4',purchase_away:'5'}),'away');
  assert.equal(selectedTennisSide({...order,purchase_home:null,purchase_away:null}),null);
});
