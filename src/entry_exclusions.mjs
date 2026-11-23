// New purchase eligibility only. Never use this policy to hide history,
// settlements, held-position management, or reduce-only exits.
const PLAYER_SERIES=/(?:PASSYDS|RUSHYDS|RECYDS|RRYDS|RECPROT|PASSATT|PASSCOMP|PASSINT|PASSTDS|PTS|PRA|REB|AST|3PT|STL|BLK|GOALS|SAVES|SOG|HITS|RBI|HR)(?:PROT)?$/;
const BASKETBALL_SERIES=/^KX(?:NBA|WNBA|NCAAM?B|NCAAWB|NBL|CBA|CBB|BASKET|FIBA|EUROLEAGUE|LNB|OLYBASK)/;

export function entryExclusionReason(game,market,legs){
 const identity=[game?.type,game?.sport_family,game?.sport,game?.details?.league,
   market?.sport,market?.sport_family,market?.category_sport].filter(Boolean).join(' ');
 const series=String(market?.event_ticker||market?.ticker||'').split('-')[0].toUpperCase();
 if(/basketball/i.test(identity)||/\b(?:NBA|WNBA|NCAAB|NCAAW|NCAAMB|NCAAWB|NBL|CBA|FIBA|EUROLEAGUE|CBB)\b/i.test(identity)||
   BASKETBALL_SERIES.test(series))return 'Basketball entries are disabled';
 const playerFields=Object.keys(market?.custom_strike||{});
 if(playerFields.some(key=>/(?:^|_)player(?:_|$)/i.test(key))||PLAYER_SERIES.test(series))
   return 'Player prop entries are disabled';
 const children=Array.isArray(legs)?legs:
   Array.isArray(game?.entryComponents)?game.entryComponents:
   Array.isArray(market?.mve_selected_legs)?market.mve_selected_legs:[];
 for(const leg of children){
   const legGame=leg?.state||leg?.game||leg?.milestone||null;
   const legMarket=leg?.market||{ticker:leg?.market_ticker,event_ticker:leg?.event_ticker};
   const violation=entryExclusionReason(legGame,legMarket);
   if(violation)return violation;
 }
 return null;
}
export function allowsNewEntry(game,market,legs){
 return entryExclusionReason(game,market,legs)===null;
}
export function assertNewEntryAllowed(game,market,legs){
 const reason=entryExclusionReason(game,market,legs);
 if(reason)throw Object.assign(Error(reason),{code:'LOCAL_ENTRY_EXCLUDED'});
}
