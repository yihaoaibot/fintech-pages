#!/usr/bin/env node
import fs from 'node:fs';
import https from 'node:https';

const UA = 'fintech-pages/0.2 (+https://yihaoaibot.github.io/fintech-pages/)';

function fetch(url){
  return new Promise((resolve,reject)=>{
    https.get(url,{headers:{'User-Agent':UA,'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'}},res=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>resolve({status:res.statusCode, data, headers:res.headers}));
    }).on('error',reject);
  });
}

function decodeEntities(s){
  return s
    .replaceAll('&amp;','&')
    .replaceAll('&lt;','<')
    .replaceAll('&gt;','>')
    .replaceAll('&quot;','"')
    .replaceAll('&#39;',"'");
}

function stripCdata(s){
  return s?.replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'') ?? '';
}

function pickFirst(text, re){
  const m = re.exec(text);
  return m ? m[1] : null;
}

function parseRssItems(xml){
  const out=[];
  const itemRe=/<item>([\s\S]*?)<\/item>/g;
  let m;
  while((m=itemRe.exec(xml))){
    const b=m[1];
    const title = decodeEntities(stripCdata(pickFirst(b,/<title>([\s\S]*?)<\/title>/i) || ''));
    const link = decodeEntities(stripCdata(pickFirst(b,/<link>([\s\S]*?)<\/link>/i) || ''));
    const pubDate = stripCdata(pickFirst(b,/<pubDate>([\s\S]*?)<\/pubDate>/i) || '');
    out.push({title, link, pubDate});
  }
  return out;
}

function parseAtomEntries(xml){
  const out=[];
  const entryRe=/<entry\b[\s\S]*?>([\s\S]*?)<\/entry>/g;
  let m;
  while((m=entryRe.exec(xml))){
    const b=m[1];
    const titleRaw = pickFirst(b,/<title\b[^>]*>([\s\S]*?)<\/title>/i) || '';
    const title = decodeEntities(stripCdata(titleRaw.trim()));

    let link = null;
    const linkTag = pickFirst(b,/<link\b[^>]*>/i);
    if(linkTag){
      const href = pickFirst(linkTag,/href="([^"]+)"/i);
      link = href || null;
    } else {
      // sometimes link is <link>url</link>
      link = decodeEntities(stripCdata(pickFirst(b,/<link>([\s\S]*?)<\/link>/i) || ''));
    }

    const updated = stripCdata(pickFirst(b,/<updated>([\s\S]*?)<\/updated>/i) || '');
    const published = stripCdata(pickFirst(b,/<published>([\s\S]*?)<\/published>/i) || '');
    out.push({title, link, pubDate: published || updated});
  }
  return out;
}

function toBJT(d){
  const bj = new Date(d.getTime() + (8*60 - d.getTimezoneOffset())*60000);
  const pad=n=>String(n).padStart(2,'0');
  return `${bj.getFullYear()}-${pad(bj.getMonth()+1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}`;
}

function within24h(dateStr){
  const d=new Date(dateStr);
  const ts=+d;
  if(!ts) return null;
  if(ts < Date.now() - 24*3600*1000) return null;
  return {d, ts};
}

const SOURCES=[
  // US/AI/chip (CN tech)
  {bucket:'us-ai-chip', source:'少数派', url:'https://sspai.com/feed'},
  {bucket:'us-ai-chip', source:'InfoQ中文', url:'https://www.infoq.cn/feed'},
  {bucket:'us-ai-chip', source:'爱范儿', url:'https://www.ifanr.com/feed'},
  {bucket:'us-ai-chip', source:'极客公园', url:'https://www.geekpark.net/rss'},

  // Macro/commodities (use 36kr newsflashes as lightweight macro stream)
  {bucket:'macro-commodities', source:'36kr快讯', url:'https://36kr.com/feed'},

  // CN stocks/industry
  {bucket:'cn-stocks-industry', source:'36kr', url:'https://36kr.com/feed'},

  // policy/regulation (placeholders; many gov sites lack RSS)
  // You can extend later with specific feeds when available.
];

async function main(){
  const buckets={
    'us-ai-chip':[],
    'macro-commodities':[],
    'cn-stocks-industry':[],
    'policy-regulation':[],
  };

  for(const s of SOURCES){
    try{
      const r=await fetch(s.url);
      if(r.status!==200) continue;
      const xml=r.data;
      const items = xml.includes('<rss') ? parseRssItems(xml) : parseAtomEntries(xml);
      for(const it of items){
        const dt = within24h(it.pubDate);
        if(!dt) continue;
        if(!it.title || !it.link) continue;
        buckets[s.bucket].push({
          time: toBJT(dt.d),
          source: s.source,
          title: it.title.trim(),
          url: it.link.trim(),
          topic: '',
          impact: '',
          crosscheck: false
        });
      }
    } catch {
      // ignore transient fetch/parse failures
    }
  }

  for(const k of Object.keys(buckets)){
    buckets[k].sort((a,b)=> b.time.localeCompare(a.time));
    // soft cap
    buckets[k]=buckets[k].slice(0,40);
  }

  const start=toBJT(new Date(Date.now()-24*3600*1000));
  const end=toBJT(new Date());
  const data={
    window_bjt: `${start} ～ ${end}`,
    generated_at_bjt: toBJT(new Date()),
    buckets
  };
  fs.writeFileSync(new URL('../docs/data.json', import.meta.url), JSON.stringify(data,null,2));
}

main();
