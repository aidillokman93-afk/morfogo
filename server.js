import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

const app = express();
app.use(express.static('public'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();
const PORT = process.env.PORT || 3000;

const categories = ['Kata Nama','Kata Kerja','Kata Adjektif','Kata Hubung','Kata Sendi'];
const examples = {
  'Kata Nama':['sekolah','guru','buku','perpustakaan','murid','rumah','sungai','keluarga','pasar','kereta'],
  'Kata Kerja':['mencuci','membaca','berlari','menulis','memasak','melukis','menyanyi','berjalan','menolong','mengemas'],
  'Kata Adjektif':['cantik','rajin','besar','ceria','bersih','tinggi','bijak','manis','pantas','tenang'],
  'Kata Hubung':['kerana','tetapi','supaya','dan','atau','sambil','lalu','jika','walaupun','serta'],
  'Kata Sendi':['kepada','dari','di','ke','daripada','untuk','pada','dengan','tentang','oleh']
};
const specialTypes = ['draw2','skip','reverse','wild'];
const specialMeta = {
  draw2:{word:'+2',label:'+2 KAD'}, skip:{word:'LANGKAU',label:'LANGKAU'}, reverse:{word:'TERBALIK',label:'TERBALIK'}, wild:{word:'TUKAR',label:'TUKAR GOLONGAN'}
};

function makeDeck(){
  const d=[]; let id=0;
  for(const cat of categories){
    for(let n=0;n<=9;n++){
      d.push({id:'c'+(++id),type:'normal',category:cat,number:n,word:examples[cat][n]});
      if(n>0) d.push({id:'c'+(++id),type:'normal',category:cat,number:n,word:examples[cat][n]});
    }
  }
  for(const type of specialTypes){ for(let i=0;i<5;i++) d.push({id:'s'+(++id),type,category:null,number:null,word:specialMeta[type].word}); }
  return d;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function roomCode(){return crypto.randomBytes(3).toString('hex').toUpperCase();}
function publicState(r){return {room:r.code,started:r.started,targetPlayers:r.targetPlayers,players:r.players.map(p=>({id:p.id,name:p.name,count:p.hand.length})),top:r.discard.at(-1),turn:r.players[r.turn]?.id||null,direction:r.direction,pending:r.pending,winner:r.winner,category:r.category};}
function send(p,msg){if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(msg));}
function broadcast(r){const msg={type:'state',state:publicState(r)};r.players.forEach(p=>send(p,msg));}
function sendHands(r){r.players.forEach(p=>send(p,{type:'hand',hand:p.hand}));}
function refill(r){if(r.deck.length<1&&r.discard.length>1){const top=r.discard.pop();r.deck=shuffle(r.discard.splice(0));r.discard=[top];}}
function startGame(r){
  r.deck=shuffle(makeDeck());r.discard=[];r.started=true;r.winner=null;r.pending=0;r.direction=1;
  r.players.forEach(p=>p.hand=[]);
  for(let i=0;i<7;i++)for(const p of r.players)p.hand.push(r.deck.pop());
  let top=r.deck.pop();while(top.type!=='normal'){r.deck.unshift(top);top=r.deck.pop();}
  r.discard.push(top);r.category=top.category;r.turn=0;
  broadcast(r);sendHands(r);
}
function nextIndex(r,steps=1){return (r.turn+r.direction*steps+r.players.length)%r.players.length;}
function advance(r,steps=1){r.turn=nextIndex(r,steps);}
function canPlay(card,r){
  if(card.type==='wild'||card.type==='draw2'||card.type==='skip'||card.type==='reverse')return true;
  const top=r.discard.at(-1);
  return card.category===r.category || card.number===top.number;
}
function dealOne(p,r){refill(r);if(r.deck.length)p.hand.push(r.deck.pop());}
function notice(p,msg){send(p,{type:'notice',message:msg});}

wss.on('connection',ws=>{
  let player=null,room=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.type==='create'){
      const target=Math.min(5,Math.max(2,Number(m.target)||2));
      const code=roomCode();room={code,targetPlayers:target,players:[],started:false,deck:[],discard:[],turn:0,direction:1,pending:0,category:null,winner:null};rooms.set(code,room);
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain 1').slice(0,24),hand:[],ws};room.players.push(player);
      send(player,{type:'joined',id:player.id,room:code,host:true});broadcast(room);return;
    }
    if(m.type==='join'){
      room=rooms.get(String(m.room||'').toUpperCase());
      if(!room)return send({ws},{type:'error',message:'Bilik permainan tidak ditemui.'});
      if(room.started)return send({ws},{type:'error',message:'Permainan sudah bermula.'});
      if(room.players.length>=room.targetPlayers)return send({ws},{type:'error',message:'Bilik sudah penuh.'});
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain').slice(0,24),hand:[],ws};room.players.push(player);
      send(player,{type:'joined',id:player.id,room:room.code,host:false});broadcast(room);return;
    }
    if(!room||!player)return;
    if(m.type==='start'){
      if(room.players[0]?.id!==player.id)return;
      if(room.players.length!==room.targetPlayers)return notice(player,`Menunggu ${room.targetPlayers-room.players.length} pemain lagi.`);
      startGame(room);return;
    }
    if(m.type==='play'){
      if(room.winner||room.players[room.turn]?.id!==player.id)return;
      const idx=player.hand.findIndex(c=>c.id===m.cardId);if(idx<0)return;
      const card=player.hand[idx];
      if(!canPlay(card,room))return notice(player,'Kad tidak sepadan. Pilih golongan kata atau nombor yang sama.');
      if(room.pending&&card.type!=='draw2')return notice(player,'Anda perlu mengambil kad +2 atau bermain kad +2.');
      if(card.type==='wild'&&!categories.includes(m.category))return notice(player,'Pilih golongan kata baharu.');
      player.hand.splice(idx,1);room.discard.push(card);
      if(card.type==='wild')room.category=m.category; // other special cards preserve the last category
      else if(card.type==='normal')room.category=card.category;
      if(player.hand.length===0){room.winner=player.id;broadcast(room);sendHands(room);return;}
      let steps=1;
      if(card.type==='draw2')room.pending=(room.pending||0)+2;
      else {room.pending=0;if(card.type==='skip')steps=2;if(card.type==='reverse'){room.direction*=-1;if(room.players.length===2)steps=2;}}
      advance(room,steps);broadcast(room);sendHands(room);return;
    }
    if(m.type==='draw'){
      if(room.winner||room.players[room.turn]?.id!==player.id)return;
      const amount=room.pending||1;for(let i=0;i<amount;i++)dealOne(player,room);room.pending=0;advance(room);broadcast(room);sendHands(room);return;
    }
  });
  ws.on('close',()=>{if(room&&player){const i=room.players.findIndex(p=>p.id===player.id);if(i>=0)room.players.splice(i,1);if(!room.players.length)rooms.delete(room.code);else{if(room.turn>=room.players.length)room.turn=0;broadcast(room);}}});
});

server.listen(PORT,()=>console.log(`MorfoGo running on ${PORT}`));
