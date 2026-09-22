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
  'Kata Nama':['6 • sekolah','3 • guru','8 • buku','1 • perpustakaan','5 • murid'],
  'Kata Kerja':['6 • mencuci','2 • membaca','9 • berlari','4 • menulis','7 • memasak'],
  'Kata Adjektif':['6 • cantik','2 • rajin','9 • besar','4 • ceria','7 • bersih'],
  'Kata Hubung':['6 • kerana','2 • tetapi','9 • supaya','4 • dan','7 • atau'],
  'Kata Sendi':['6 • kepada','2 • dari','9 • di','4 • ke','7 • daripada']
};
function makeDeck(){
  const d=[]; let id=0;
  for(const cat of categories){
    for(let n=0;n<=9;n++){
      const ex=examples[cat][n%examples[cat].length].split(' • ')[1];
      d.push({id:'c'+(++id),type:'normal',category:cat,number:n,word:ex});
      if(n>0) d.push({id:'c'+(++id),type:'normal',category:cat,number:n,word:ex});
    }
  }
  for(let i=0;i<5;i++) d.push({id:'s'+(++id),type:'draw2',category:null,number:null,word:'+2'});
  for(let i=0;i<5;i++) d.push({id:'s'+(++id),type:'skip',category:null,number:null,word:'LANGKAU'});
  for(let i=0;i<5;i++) d.push({id:'s'+(++id),type:'reverse',category:null,number:null,word:'TERBALIK'});
  for(let i=0;i<5;i++) d.push({id:'s'+(++id),type:'wild',category:null,number:null,word:'TUKAR GOLONGAN'});
  return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function roomCode(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function publicState(r){
  return {room:r.code,started:r.started,players:r.players.map(p=>({id:p.id,name:p.name,count:p.hand.length})),current:r.current,top:r.discard[r.discard.length-1],turn:r.players[r.turn]?.id||null,direction:r.direction,pending:r.pending,winner:r.winner,category:r.category};
}
function broadcast(r){ const msg=JSON.stringify({type:'state',state:publicState(r)}); for(const p of r.players) if(p.ws?.readyState===1) p.ws.send(msg); }
function send(p,msg){ if(p.ws?.readyState===1) p.ws.send(JSON.stringify(msg)); }
function startGame(r){
  r.deck=shuffle(makeDeck()); r.discard=[]; r.started=true; r.winner=null; r.pending=0; r.direction=1;
  for(const p of r.players) p.hand=[];
  for(let i=0;i<7;i++) for(const p of r.players) p.hand.push(r.deck.pop());
  let top=r.deck.pop(); while(top.type==='wild'||top.type==='draw2'||top.type==='skip'||top.type==='reverse'){r.deck.unshift(top); top=r.deck.pop();}
  r.discard.push(top); r.category=top.category; r.turn=0;
  broadcast(r); r.players.forEach(p=>send(p,{type:'hand',hand:p.hand}));
}
function nextIndex(r,steps=1){ return (r.turn + r.direction*steps + r.players.length)%r.players.length; }
function refill(r){ if(r.deck.length<1 && r.discard.length>1){ const top=r.discard.pop(); r.deck=shuffle(r.discard.splice(0)); r.discard=[top]; } }
function canPlay(card,r){ const top=r.discard[r.discard.length-1]; if(card.type==='wild') return true; if(card.type==='draw2') return top.type==='draw2'||card.category===r.category; if(card.type==='skip'||card.type==='reverse') return card.category===r.category || card.type===top.type; return card.category===r.category || card.number===top.number; }
function dealOne(p,r){ refill(r); if(r.deck.length) p.hand.push(r.deck.pop()); }
function advance(r,steps=1){ r.turn=nextIndex(r,steps); }

wss.on('connection',ws=>{
  let player=null, room=null;
  ws.on('message',raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==='create'){
      const code=roomCode(); room={code,players:[],started:false,deck:[],discard:[],turn:0,direction:1,pending:0,category:null,winner:null}; rooms.set(code,room);
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain 1').slice(0,24),hand:[],ws}; room.players.push(player); send(player,{type:'joined',id:player.id,room:code,host:true}); broadcast(room); return;
    }
    if(m.type==='join'){
      room=rooms.get(String(m.room||'').toUpperCase()); if(!room) return send({ws},{type:'error',message:'Bilik permainan tidak ditemui.'});
      if(room.started) return send({ws},{type:'error',message:'Permainan sudah bermula.'});
      if(room.players.length>=5) return send({ws},{type:'error',message:'Maksimum 5 peranti sahaja.'});
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain').slice(0,24),hand:[],ws}; room.players.push(player); send(player,{type:'joined',id:player.id,room:room.code,host:false}); broadcast(room); return;
    }
    if(!room||!player) return;
    if(m.type==='start'){ if(room.players[0]?.id===player.id && room.players.length>=2) startGame(room); return; }
    if(m.type==='play'){
      if(room.winner || room.players[room.turn]?.id!==player.id) return;
      const idx=player.hand.findIndex(c=>c.id===m.cardId); if(idx<0) return;
      const card=player.hand[idx]; if(!canPlay(card,room)) return send(player,{type:'notice',message:'Kad tidak sepadan. Pilih golongan atau nombor yang sama.'});
      if(room.pending && card.type!=='draw2') return send(player,{type:'notice',message:'Pemain perlu menambah 2 kad atau bermain kad +2.'});
      player.hand.splice(idx,1); room.discard.push(card); if(card.type==='wild'){room.category=m.category&&categories.includes(m.category)?m.category:room.category;} else room.category=card.category;
      if(player.hand.length===0){room.winner=player.id; broadcast(room); room.players.forEach(p=>p.ws?.readyState===1&&p.ws.send(JSON.stringify({type:'hand',hand:p.hand}))); return;}
      let steps=1;
      if(card.type==='draw2'){ room.pending=(room.pending||0)+2; }
      else if(card.type==='skip') steps=2;
      else if(card.type==='reverse') { room.direction*=-1; if(room.players.length===2) steps=2; }
      else room.pending=0;
      advance(room,steps); broadcast(room); room.players.forEach(p=>send(p,{type:'hand',hand:p.hand})); return;
    }
    if(m.type==='draw'){
      if(room.winner || room.players[room.turn]?.id!==player.id) return;
      const amount=room.pending||1; for(let i=0;i<amount;i++) dealOne(player,room); room.pending=0; advance(room); broadcast(room); room.players.forEach(p=>send(p,{type:'hand',hand:p.hand})); return;
    }
    if(m.type==='restart' && room.players[0]?.id===player.id){ startGame(room); }
  });
  ws.on('close',()=>{ if(room&&player){ const idx=room.players.findIndex(p=>p.id===player.id); if(idx>=0) room.players.splice(idx,1); if(room.players.length===0) rooms.delete(room.code); else { if(room.turn>=room.players.length) room.turn=0; broadcast(room); } } });
});
server.listen(PORT,()=>console.log(`MorfoGo running on ${PORT}`));
