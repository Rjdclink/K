import {mentionDay} from './mentions.mjs';

export function dueMentionSeries(catalog,schedule={},now=Date.now()){
  const today=mentionDay(now);
  return catalog.filter(series=>{
    const old=schedule[series.ticker];
    if(!old||old.updatedAt!==(series.last_updated_ts||null))return true;
    if(old.today)return true;
    if(old.future&&mentionDay(old.checkedAt)!==today)return true;
    if(old.future)return false;
    return now-Number(old.checkedAt)>=15*60_000;
  });
}
