import test from 'node:test';import assert from 'node:assert/strict';
import {cbsPlayerValue,yahooPlayerValue,yahooGames} from '../src/alternate_scores.mjs';
const player={name:'Matas Buzelis',metric:'REB'};
test('CBS boxscore parses header-aligned exact player stat and ignores recap text',()=>{
 const html='<p>Matas Buzelis six rebounds</p><table class="stats-table"><tr><td>Starters</td><td>PTS</td><td>REB</td></tr><tr><td><a href="/nba/players/29275373/matas-buzelis/">M. Buzelis</a></td><td>17</td><td>5</td></tr></table>';
 assert.equal(cbsPlayerValue(html,player),5);assert.equal(cbsPlayerValue(html,{...player,name:'Other Player'}),null);
});
test('Yahoo uses the game player table rather than player season averages',()=>{
 const g={gameId:'nba.g.2026102804',playerStats:{homeTables:[{tableStats:[{player:{displayName:'Matas Buzelis',playerGameStats0:[{stats:[{statId:'TOTAL_REBOUNDS',value:'5'}]}]}}]}]}};
 const html='self.__next_f.push([1,'+JSON.stringify('aa:'+JSON.stringify(g)+'\n')+'])';
 assert.equal(yahooGames(html).length,1);assert.equal(yahooPlayerValue(yahooGames(html)[0],player),5);assert.equal(yahooPlayerValue(g,{...player,metric:'AST'}),null);
});
