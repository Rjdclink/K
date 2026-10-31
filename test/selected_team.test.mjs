import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedTeamName} from '../src/selected_team.mjs';

test('a blank live-feed team name still highlights the exact chosen winner',()=>{
  const base={strategy:'lead',game_title:'Millwall vs Derby',market_ticker:'KXEFLCHAMPIONSHIPGAME-MILDER-MIL',
    reason:'Externally verified 20% lead:  leads 3–0 goals; second half, 3 goals ahead',
    game_signals:[{ticker:'KXEFLCHAMPIONSHIPGAME-MILDER-MIL',title:'Millwall wins'}]};
  assert.equal(selectedTeamName(base),'Millwall');
  assert.equal(selectedTeamName({...base,game_title:'Worthing vs Sutton',game_signals:[{...base.game_signals[0],title:'Sutton wins'}]}),'Sutton');
  assert.equal(selectedTeamName({...base,game_signals:[{...base.game_signals[0],title:'Derby wins by 3'}]}),null);
});
