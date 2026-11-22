import test from 'node:test';
import assert from 'node:assert/strict';
import {playerStatValue} from '../src/score_verification.mjs';

// ESPN hockey uses A=assists, HT=hits, S=shots on goal; SOG is
// shootout goals (not shots on goal). Preserve NBA's AST and 3PT.
const stats=(name,headers,values,group='forwards')=>({boxscore:{players:[{statistics:[{
 name:group,labels:headers,athletes:[{athlete:{displayName:name},stats:values}]
}]}]}});
test('NHL A, HT and S are mapped to contract assists, hits and shots on goal',()=>{
 const s=stats('Jackson Blake',
  ['G','A','HT','S','SOG','SV'],['1','2','3','5','0','0']);
 assert.equal(playerStatValue(s,{name:'Jackson Blake',metric:'GOALS'}),1);
 assert.equal(playerStatValue(s,{name:'Jackson Blake',metric:'AST'}),2);
 assert.equal(playerStatValue(s,{name:'Jackson Blake',metric:'HITS'}),3);
 assert.equal(playerStatValue(s,{name:'Jackson Blake',metric:'SOG'}),5,
  'ESPN SOG shootout goals must never be used for player shots on goal');
 assert.equal(playerStatValue(s,{name:'Another Player',metric:'SOG'}),null);
});
test('NHL goalie SV remains saves, NBA AST/3PT remain basketball values',()=>{
 const goalie=stats('Goalie',['GA','SA','SV'],['1','27','26'],'goalies');
 assert.equal(playerStatValue(goalie,{name:'Goalie',metric:'SAVES'}),26);
 const nba=stats('NBA Player',['PTS','REB','AST','3PT','STL','BLK'],
  ['12','5','4','3','1','2'],'starters');
 for(const [metric,value] of [['PTS',12],['REB',5],['AST',4],['3PT',3],['STL',1],['BLK',2],['PRA',21]])
  assert.equal(playerStatValue(nba,{name:'NBA Player',metric}),value,metric);
});
test('NFL PASSYDS, RUSHYDS and RECYDS use only the appropriate YDS group',()=>{
 const summary={boxscore:{players:[{statistics:[
  {name:'passing',names:['YDS'],athletes:[{athlete:{displayName:'Player'},stats:['100']}]},
  {name:'rushing',names:['YDS'],athletes:[{athlete:{displayName:'Player'},stats:['20']}]},
  {name:'receiving',names:['YDS'],athletes:[{athlete:{displayName:'Player'},stats:['15']}]}
 ]}]}};
 for(const [metric,value] of [['PASSYDS',100],['RUSHYDS',20],['RECYDS',15]])
  assert.equal(playerStatValue(summary,{name:'Player',metric}),value,metric);
});

import {foxPlayerStat} from '../src/score_verification.mjs';
test('FOX NHL uses independently confirmed G, A, S, H and SV labels without overriding basketball AST',()=>{
 const columns=(labels,values,name)=>({headers:[{columns:labels.map((text,index)=>({text,index}))}],
  rows:[{entityLink:{title:name},columns:values.map((text,index)=>({index,text:String(text)}))}]});
 const skaters=columns(['SKATERS','G','A','S','H'],['Player',1,2,5,3],'JACKSON BLAKE');
 const goalies=columns(['GOALKEEPERS','SA','SV'],['Goalie',27,26],'BRANDON BUSSI');
 const data={header:{id:'44926'},boxscore:{boxscoreSections:[{boxscoreItems:[
  {boxscoreTable:skaters},{boxscoreTable:goalies}]}]}};
 for(const [metric,value] of [['GOALS',1],['AST',2],['SOG',5],['HITS',3]])
  assert.equal(foxPlayerStat(data,{name:'Jackson Blake',metric},'44926'),value,metric);
 assert.equal(foxPlayerStat(data,{name:'Brandon Bussi',metric:'SAVES'},'44926'),26);
 assert.equal(foxPlayerStat(data,{name:'Jackson Blake',metric:'AST'},'other-event'),null);
 const basketball={header:{id:'nba'},boxscore:{boxscoreSections:[{boxscoreItems:[
  {boxscoreTable:columns(['PLAYER','PTS','AST'],['NBA Player',23,4],'NBA PLAYER')}
 ]}]}};
 assert.equal(foxPlayerStat(basketball,{name:'NBA Player',metric:'AST'},'nba'),4);
});
