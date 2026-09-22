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
  draw2:{word:'+2',label:'+2 KAD'},
  skip:{word:'LANGKAU',label:'LANGKAU'},
  reverse:{word:'TERBALIK',label:'TERBALIK'},
  wild:{word:'TUKAR',label:'TUKAR GOLONGAN'}
};
const TOTAL_ROUNDS = 10;

function makeDeck(){
  const d=[]; let id=0;
  for(const cat of categories){
    for(let n=0;n<=9;n++){
      d.push({id:'c'+(++id),type:'normal',category:cat,number:n,word:examples[cat][n]});
      if(n>0) d.push({id:'c'+(++id),type:'normal',category:cat,number:n,word:examples[cat][n]});
    }
  }
  for(const type of specialTypes){
    for(let i=0;i<5;i++) d.push({id:'s'+(++id),type,category:null,number:null,word:specialMeta[type].word});
  }
  return d;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function roomCode(){return crypto.randomBytes(3).toString('hex').toUpperCase();}
function send(p,msg){if(p?.ws?.readyState===1)p.ws.send(JSON.stringify(msg));}
function broadcast(r){const msg={type:'state',state:publicState(r)};r.players.forEach(p=>send(p,msg));}
function sendHands(r){r.players.forEach(p=>send(p,{type:'hand',hand:p.hand}));}
function refill(r){if(r.deck.length<1&&r.discard.length){r.deck=shuffle(r.discard.splice(0));}}
function currentPlayer(r){return r.players[r.turn];}
function nextIndex(r,steps=1){return (r.turn+r.direction*steps+r.players.length)%r.players.length;}
function advance(r,steps=1){r.turn=nextIndex(r,steps);}
function publicState(r){
  return {
    room:r.code,started:r.started,targetPlayers:r.targetPlayers,
    round:r.round,totalRounds:TOTAL_ROUNDS,category:r.category,
    players:r.players.map(p=>({id:p.id,name:p.name,count:p.hand.length,score:r.scores[p.id]||0})),
    turn:currentPlayer(r)?.id||null,direction:r.direction,
    plays:r.plays.map(x=>({playerId:x.playerId,name:x.name,card:x.card,score:x.score||0,special:x.special||false})),
    roundWinner:r.roundWinner,winner:r.winner,roundPoints:r.roundPoints||0,
    notice:r.roundNotice||''
  };
}
function dealOne(p,r){refill(r);if(r.deck.length)p.hand.push(r.deck.pop());}
function dealUpToSeven(p,r){while(p.hand.length<7)dealOne(p,r);}
function chooseCategory(r,category){if(categories.includes(category))r.category=category;}
function startGame(r){
  r.deck=shuffle(makeDeck());r.discard=[];r.started=true;r.round=1;r.direction=1;r.winner=null;r.roundWinner=null;r.roundPoints=0;r.roundNotice='';r.scores={};
  r.players.forEach(p=>{p.hand=[];r.scores[p.id]=0;});
  for(let i=0;i<7;i++)for(const p of r.players)dealOne(p,r);
  r.category=null;r.turn=0;r.plays=[];r.opener=0;
  broadcast(r);sendHands(r);
  send(r.players[0],{type:'notice',message:'Anda pembuka. Pilih satu kad golongan kata untuk memulakan pusingan.'});
}
function eligibleNormal(card,r){return card.type==='normal' && card.category===r.category;}
function finishRound(r){
  const normalPlays=r.plays.filter(x=>x.card.type==='normal');
  if(!normalPlays.length){
    r.roundWinner=null;r.roundPoints=0;r.roundNotice='Tiada kad bernombor dimainkan.';
  }else{
    const max=Math.max(...normalPlays.map(x=>x.card.number));
    const winnerPlay=normalPlays.find(x=>x.card.number===max);
    r.roundWinner=winnerPlay.playerId;
    r.roundPoints=max;
    r.scores[winnerPlay.playerId]=(r.scores[winnerPlay.playerId]||0)+max;
    r.roundNotice=`${winnerPlay.name} menang pusingan dengan ${max} mata.`;
  }
  r.opener=r.players.findIndex(p=>p.id===r.roundWinner);
  if(r.opener<0)r.opener=r.turn;
  r.round++;
  if(r.round>TOTAL_ROUNDS){
    const maxScore=Math.max(...r.players.map(p=>r.scores[p.id]||0));
    const winners=r.players.filter(p=>(r.scores[p.id]||0)===maxScore);
    r.winner=winners[0]?.id||null;
    r.roundNotice=winners.length>1?`Seri! ${winners.map(p=>p.name).join(', ')} memperoleh ${maxScore} mata.`:`${winners[0]?.name||'Pemain'} ialah JUARA MORFOGO dengan ${maxScore} mata.`;
    broadcast(r);sendHands(r);return;
  }
  r.category=null;r.plays=[];r.roundWinner=null;r.roundPoints=0;r.turn=r.opener;
  r.players.forEach(p=>dealUpToSeven(p,r));
  broadcast(r);sendHands(r);
  send(currentPlayer(r),{type:'notice',message:'Anda pembuka pusingan seterusnya. Pilih kad golongan kata.'});
}

wss.on('connection',ws=>{
  let player=null,room=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.type==='create'){
      const target=Math.min(5,Math.max(2,Number(m.target)||2));
      const code=roomCode();
      room={code,targetPlayers:target,players:[],started:false,deck:[],discard:[],turn:0,opener:0,direction:1,category:null,round:0,plays:[],scores:{},roundWinner:null,roundPoints:0,roundNotice:'',winner:null};
      rooms.set(code,room);
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain 1').slice(0,24),hand:[],ws};room.players.push(player);room.scores[player.id]=0;
      send(player,{type:'joined',id:player.id,room:code,host:true});broadcast(room);return;
    }
    if(m.type==='join'){
      room=rooms.get(String(m.room||'').toUpperCase());
      if(!room)return send({ws},{type:'error',message:'Bilik permainan tidak ditemui.'});
      if(room.started)return send({ws},{type:'error',message:'Permainan sudah bermula.'});
      if(room.players.length>=room.targetPlayers)return send({ws},{type:'error',message:'Bilik sudah penuh.'});
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain').slice(0,24),hand:[],ws};room.players.push(player);room.scores[player.id]=0;
      send(player,{type:'joined',id:player.id,room:room.code,host:false});broadcast(room);return;
    }
    if(!room||!player)return;
    if(m.type==='start'){
      if(room.players[0]?.id!==player.id)return;
      if(room.players.length!==room.targetPlayers)return send(player,{type:'notice',message:`Menunggu ${room.targetPlayers-room.players.length} pemain lagi.`});
      startGame(room);return;
    }
    if(room.winner)return;

    if(m.type==='play'){
      if(room.players[room.turn]?.id!==player.id)return send(player,{type:'notice',message:'Bukan giliran anda.'});
      const idx=player.hand.findIndex(c=>c.id===m.cardId);if(idx<0)return;
      const card=player.hand[idx];

      // Pembuka mesti menetapkan golongan kata dengan kad biasa atau Wild.
      if(room.category===null){
        if(card.type==='wild'){
          if(!categories.includes(m.category))return send(player,{type:'notice',message:'Pilih golongan kata baharu.'});
          player.hand.splice(idx,1);room.discard.push(card);chooseCategory(room,m.category);
          room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        }else if(card.type==='normal'){
          player.hand.splice(idx,1);room.discard.push(card);room.category=card.category;
          room.plays.push({playerId:player.id,name:player.name,card,score:card.number});
        }else{
          return send(player,{type:'notice',message:'Pemain pembuka perlu memilih kad golongan kata. Kad special boleh digunakan selepas kategori dipilih.'});
        }
        advance(room);broadcast(room);sendHands(room);return;
      }

      // Selepas kategori dipilih, pemain boleh memainkan kad kategori atau special.
      if(card.type==='normal'){
        if(!eligibleNormal(card,room))return send(player,{type:'notice',message:`Pilih kad ${room.category}.`});
        player.hand.splice(idx,1);room.discard.push(card);room.plays.push({playerId:player.id,name:player.name,card,score:card.number});
        advance(room);broadcast(room);sendHands(room);
        if(room.plays.filter(x=>x.playerId).length>=room.players.length)finishRound(room);
        return;
      }

      if(card.type==='wild'){
        if(!categories.includes(m.category))return send(player,{type:'notice',message:'Pilih golongan kata baharu.'});
        player.hand.splice(idx,1);room.discard.push(card);chooseCategory(room,m.category);room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        advance(room);broadcast(room);sendHands(room);return;
      }
      if(card.type==='draw2'){
        player.hand.splice(idx,1);room.discard.push(card);room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        const next=room.players[nextIndex(room)];if(next){dealOne(next,room);dealOne(next,room);send(next,{type:'notice',message:'Kad +2! Anda menerima 2 kad.'});}
        advance(room);broadcast(room);sendHands(room);return;
      }
      if(card.type==='skip'){
        player.hand.splice(idx,1);room.discard.push(card);room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        advance(room,2);broadcast(room);sendHands(room);return;
      }
      if(card.type==='reverse'){
        player.hand.splice(idx,1);room.discard.push(card);room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        room.direction*=-1;if(room.players.length===2)advance(room,2);else advance(room);broadcast(room);sendHands(room);return;
      }
    }
    if(m.type==='draw'){
      if(room.players[room.turn]?.id!==player.id)return;
      dealOne(player,room);sendHands(room);broadcast(room);return;
    }
  });
  ws.on('close',()=>{if(room&&player){const i=room.players.findIndex(p=>p.id===player.id);if(i>=0)room.players.splice(i,1);if(!room.players.length)rooms.delete(room.code);else{if(room.turn>=room.players.length)room.turn=0;broadcast(room);}}});
});
server.listen(PORT,()=>console.log(`MorfoGo running on ${PORT}`));
