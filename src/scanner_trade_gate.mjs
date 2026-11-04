// Scanner observations may be displayed, but neither scanner may send an order.
export function assertScannerTradeDisabled(path,method,entryVerifications=[]){
  if(method!=='POST'||!/^\/portfolio\/(?:events\/)?orders(?:\/batched)?$/.test(path.split('?')[0]))return;
  if(entryVerifications.some(({game})=>['mentions','crypto'].includes(String(game?.type||'').toLowerCase())||
    ['mentions','crypto'].includes(String(game?.sport||'').toLowerCase())))
    throw Object.assign(Error('Mentions and Crypto scanner trading is disabled'),{code:'LOCAL_SCANNER_TRADING_DISABLED'});
}
