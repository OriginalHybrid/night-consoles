import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('shared/data/market-deck/market.json');
const TICKERS = [
  ['NVDA','NVIDIA Corp','Semiconductors',142.86],
  ['AAPL','Apple Inc','Technology',228.40],
  ['MSFT','Microsoft Corp','Software',431.20],
  ['AMZN','Amazon.com Inc','Consumer',201.33],
  ['GOOGL','Alphabet Inc','Internet',191.20],
  ['META','Meta Platforms','Internet',582.40],
  ['TSLA','Tesla Inc','Automotive',248.10],
  ['JPM','JPMorgan Chase','Financials',244.10],
  ['XOM','Exxon Mobil','Energy',118.22],
  ['SPY','SPDR S&P 500 ETF','ETF',581.40],
  ['AMD','Advanced Micro Devices','Semiconductors',158.20],
  ['NFLX','Netflix Inc','Media',712.40],
  ['COST','Costco Wholesale','Retail',912.30],
  ['QQQ','Invesco QQQ Trust','ETF',492.10]
];

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const rnd = mulberry32(0x4D41524B);
const pad = (n,w=2)=>String(n).padStart(w,'0');
const round = (v,d=2)=>Number(v.toFixed(d));

function makeSeries(base, seed, n=120){
  const r = mulberry32(seed);
  let p = base * (0.72 + r() * 0.2);
  const out = [];
  for (let i=0;i<n;i++){
    const regime = i < n*.35 ? .0012 : i < n*.7 ? -.0004 : .0018;
    const shock = (r()-.5)*.028;
    const drift = regime + Math.sin(i/17+seed)*.0011 + shock*.18;
    const open = p;
    const close = Math.max(1, open * (1 + drift + (r()-.5)*.012));
    const hi = Math.max(open,close) * (1 + r()*.009);
    const lo = Math.min(open,close) * (1 - r()*.009);
    const vol = Math.round((2.4e6 + r()*9e6) * (1 + Math.abs(drift)*24));
    out.push({t:i,o:round(open),h:round(hi),l:round(lo),c:round(close),v:vol});
    p = close;
  }
  const scale = base / out[out.length-1].c;
  for (const k of out){ k.o=round(k.o*scale);k.h=round(k.h*scale);k.l=round(k.l*scale);k.c=round(k.c*scale); }
  return out;
}
const NEWS_TEMPLATES = [
  ['EARNINGS','Quarterly results beat estimates as demand accelerates','HIGH'],
  ['GUIDANCE','Company raises full-year outlook after strong order book','HIGH'],
  ['LEGAL','Regulators open review of proposed business practice','HIGH'],
  ['M&A','Reports of acquisition talks lift sector peers','HIGH'],
  ['ANALYST','Analyst raises price target, cites margin expansion','MEDIUM'],
  ['PRODUCT','New product cycle could reset growth expectations','MEDIUM'],
  ['LEADERSHIP','Executive changes prompt strategy questions','MEDIUM'],
  ['MACRO','Rate expectations and tariffs reshape sector outlook','MEDIUM'],
  ['CAPITAL','Board approves additional buyback authorization','LOW'],
  ['SECTOR','Sector rotation drives relative performance','LOW']
];
function newsFor(sym,name){
  const r = mulberry32(sym.split('').reduce((a,c)=>a+c.charCodeAt(0),0));
  const list=[];
  for(let i=0;i<6;i++){
    const t=NEWS_TEMPLATES[(i+Math.floor(r()*NEWS_TEMPLATES.length))%NEWS_TEMPLATES.length];
    list.push({
      title:name+' · '+t[1],
      source:['Reuters','Bloomberg','MarketWatch','CNBC','Barron\'s','Financial Times'][i%6],
      time:['2h','4h','6h','1d','1d','2d'][i%6],
      tag:t[0],impact:t[2],url:'https://www.google.com/search?q='+encodeURIComponent(name+' '+t[0])
    });
  }
  return list;
}

const watchlist = [];
const series = {};
const newsFallback = {};
TICKERS.forEach(([symbol,name,sector,base],i)=>{
  const s = makeSeries(base, 1000+i*97);
  series[symbol]=s;
  const last=s[s.length-1].c, prev=s[s.length-2].c;
  const changePct=round((last-prev)/prev*100,2);
  watchlist.push({
    symbol,name,sector,price:last,changePct,
    volume:s[s.length-1].v,
    signal:changePct>1.1?'BUY':changePct<-1.1?'SELL':'HOLD',
    spark:s.slice(-20).map(x=>x.c)
  });
  newsFallback[symbol]=newsFor(symbol,name);
});

const commodities = [
  ['GOLD','XAU/USD',2412.40,0.42,'oz'],['SILVER','XAG/USD',31.18,-0.18,'oz'],
  ['WTI','CL=F',78.42,1.10,'bbl'],['BRENT','BZ=F',82.16,0.84,'bbl'],
  ['COPPER','HG=F',4.62,-0.36,'lb'],['NAT GAS','NG=F',2.84,2.14,'MMBtu'],
  ['DXY','DXY',104.28,0.12,'idx'],['US10Y','^TNX',4.18,-0.03,'%'],['VIX','^VIX',14.20,-2.40,'idx']
].map(([label,symbol,price,changePct,unit],i)=>({label,symbol,price,changePct,unit,spark:Array.from({length:12},(_,k)=>round(price*(1+Math.sin((k+i)*1.7)*.008),2))}));

const crypto = [
  ['BTC','bitcoin','Bitcoin',67420,1.24],['ETH','ethereum','Ethereum',3182,0.88],
  ['SOL','solana','Solana',148.20,-0.42],['XRP','ripple','XRP',2.18,2.05],
  ['DOGE','dogecoin','Dogecoin',0.164,1.42],['ADA','cardano','Cardano',0.92,-0.74],
  ['AVAX','avalanche-2','Avalanche',38.40,1.11],['LINK','chainlink','Chainlink',24.10,-0.22]
].map(([symbol,id,name,price,changePct])=>({symbol,id,name,price,changePct,spark:Array.from({length:12},(_,k)=>round(price*(1+Math.sin(k*1.3+symbol.length)*.012),price<1?4:2))}));

const market = {
  session:'OPEN',
  indices:[
    {label:'S&P 500',value:'5,812.40',changePct:0.42},
    {label:'NASDAQ 100',value:'20,441.20',changePct:0.71},
    {label:'DOW',value:'43,118.80',changePct:0.18},
    {label:'VIX',value:'14.20',changePct:-2.40},
    {label:'US 10Y',value:'4.18%',changePct:-0.03}
  ],
  breadth:{advancers:3120,decliners:1780,newHighs:142,newLows:38,volume:'+18%'},
  sectors:[
    ['Technology',1.24],['Semiconductors',1.82],['Energy',0.44],['Financials',-0.18],
    ['Health Care',0.12],['Consumer',-0.32],['Industrials',0.28],['Utilities',-0.11]
  ]
};

const positions = [
  {symbol:'NVDA',qty:120,avg:132.40,last:142.86},
  {symbol:'MSFT',qty:40,avg:418.10,last:431.20},
  {symbol:'SPY',qty:60,avg:568.20,last:581.40},
  {symbol:'XOM',qty:150,avg:121.10,last:118.22}
].map(p=>({...p,pnl:round((p.last-p.avg)*p.qty,2),pnlPct:round((p.last/p.avg-1)*100,2)}));

const risk = {
  beta:1.42, sharpe:1.18, var95:1.84, exposure:62.4, margin:18.2,
  volatility:22.6, maxDrawdown:-8.4, cash:37.6
};

const data = {
  meta:{slug:'market-deck',generated:new Date().toISOString(),disclaimer:'Simulated market analytics for interface demonstration only. Not investment advice.'},
  asof:'2026-11-11T14:32:00-05:00',
  market, watchlist, series, commodities, crypto, positions, risk, newsFallback
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(data,null,2)+'\n','utf8');
console.log('wrote',OUT,'tickers',watchlist.length,'series',Object.keys(series).length);
