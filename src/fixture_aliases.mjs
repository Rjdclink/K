// Source-name comparison only; a relaxed team name NEVER independently
// authorizes a purchase. The caller must require a full two-team fixture,
// the same kickoff, the same score, and an unambiguous provider event.
const asText=value=>String(value||'');
const replacements={ø:'o',Ø:'O',ł:'l',Ł:'L',đ:'d',Đ:'D',æ:'ae',Æ:'Ae',œ:'oe',Œ:'Oe',ß:'ss'};
const abbreviated={utd:'united',univ:'university',ath:'athletic',wndrs:'wanderers',st:'saint'};
// Geographical initials are language forms, not exceptions for one team.
const geographical={ny:['new','york'],nj:['new','jersey'],la:['los','angeles'],sf:['san','francisco'],
  nc:['north','carolina'],sc:['south','carolina']};
const ignored=new Set(['fc','cf','sc','afc','ac','club','football','soccer']);

export const normalizedTokens=value=>asText(value).replace(/[øØłŁđĐæÆœŒß]/g,char=>replacements[char])
 .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/)
 .flatMap(word=>geographical[word]||[abbreviated[word]||word]).filter(word=>word&&!ignored.has(word));

const consonants=s=>s.replace(/[aeiou]/g,'');
const editDistance=(a,b)=>{
 if(Math.abs(a.length-b.length)>2)return 3;
 let prior=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const row=[i];
  for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prior[j]+1,
    prior[j-1]+(a[i-1]===b[j-1]?0:1));
  prior=row;
 }
 return prior[b.length];
};
const tokenCompatible=(a,b)=>{
 if(a===b)return 3;
 if(a.length===1||b.length===1)return (a[0]===b[0]?1:0);
 const short=a.length<=b.length?a:b,long=a.length>b.length?a:b;
 if(short.length>=3&&long.startsWith(short))return 2;
 if(short.length>=3&&Math.min(a.length,b.length)>=4&&editDistance(a,b)<=1)return 2;
 const ac=consonants(a),bc=consonants(b);
 if(short.length>=4&&ac.length>=3&&bc.length>=3&&editDistance(ac,bc)<=1)return 2;
 return 0;
};
const initials=words=>words.map(s=>s[0]).join('');

// Confidence is a local naming score, not a probability of identity.
const compareNames=(expected,actual)=>{
 const left=normalizedTokens(expected),right=normalizedTokens(actual);
 if(!left.length||!right.length)return 0;
 if(left.join('')===right.join(''))return 3;
 if(left.length===1&&right.length>1&&left[0]===initials(right)&&left[0].length>=2)return 2;
 if(right.length===1&&left.length>1&&right[0]===initials(left)&&right[0].length>=2)return 2;
 const used=new Set();let matched=0,exact=0,weak=0;
 for(const word of left){
  let best=-1,rating=0;
  for(let i=0;i<right.length;i++){
   if(used.has(i))continue;
   const similarity=tokenCompatible(word,right[i]);
   if(similarity>rating){rating=similarity;best=i;}
  }
  if(rating===0)return 0;
  used.add(best);matched+=rating;
  if(rating===3)exact++;
  if(rating===1)weak++;
 }
 // A single one-letter abbreviation is permissible only when two other
 // meaningful words are exact; prevent 'WAS Eagles' -> 'WAS Commanders'.
 if(weak&&(weak>1||exact<2))return 0;
 if(left.length===1&&left[0].length<3)return 0;
 const extra=right.filter((_,i)=>!used.has(i));
 // College provider names often append mascots. A known school/city name
 // can have extra words, but two unmatched competing mascots never match.
 if(left.length>1&&extra.length>2)return 0;
 return matched>=left.length*2?2:0;
};

export function relaxedTeamCompatibility(expected,aliases,sport){
 if(!['Soccer','NHL','NBA','WNBA','NCAAB','NCAAW','NFL','CFB'].includes(String(sport||'')))return 0;
 const list=Array.isArray(aliases)?aliases:[aliases];
 return Math.max(0,...list.map(alias=>compareNames(expected,alias)));
}