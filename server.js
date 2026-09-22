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
function broadcast(r){r.players.forEach(p=>send(p,{type:'state',state:publicState(r)}));}
function sendHands(r){r.players.forEach(p=>send(p,{type:'hand',hand:p.hand}));}
function refill(r){
  if(r.deck.length<1 && r.discard.length>0){
    r.deck=shuffle(r.discard.splice(0));
  }
}
function dealOne(p,r){refill(r);if(r.deck.length)p.hand.push(r.deck.pop());}
function dealUpToSeven(p,r){while(p.hand.length<7)dealOne(p,r);}
function currentPlayer(r){return r.players[r.turn];}
function nextIndex(r,steps=1){return (r.turn+r.direction*steps+r.players.length)%r.players.length;}
function findNextUnresolved(r,fromIndex=r.turn,steps=1){
  if(!r.players.length)return -1;
  let idx=fromIndex;
  for(let i=0;i<r.players.length;i++){
    idx=(idx+r.direction*steps+r.players.length)%r.players.length;
    if(!r.resolvedIds.includes(r.players[idx].id))return idx;
  }
  return -1;
}
function markResolved(r,playerId){if(!r.resolvedIds.includes(playerId))r.resolvedIds.push(playerId);}
function allResolved(r){return r.resolvedIds.length>=r.players.length;}
function chooseCategory(r,category){if(categories.includes(category))r.category=category;}
function publicState(r){
  return {
    room:r.code,
    started:r.started,
    targetPlayers:r.targetPlayers,
    round:r.round,
    totalRounds:TOTAL_ROUNDS,
    category:r.category,
    players:r.players.map(p=>({id:p.id,name:p.name,count:p.hand.length,score:r.scores[p.id]||0})),
    turn:currentPlayer(r)?.id||null,
    direction:r.direction,
    plays:r.plays.map(x=>({playerId:x.playerId,name:x.name,card:x.card,score:x.score||0,special:x.special||false,skipped:x.skipped||false,chosenCategory:x.chosenCategory||null})),
    roundWinner:r.roundWinner,
    winner:r.winner,
    roundPoints:r.roundPoints||0,
    roundNotice:r.roundNotice||''
  };
}
function startGame(r){
  r.deck=shuffle(makeDeck());
  r.discard=[];
  r.started=true;
  r.round=1;
  r.direction=1;
  r.winner=null;
  r.roundWinner=null;
  r.roundPoints=0;
  r.roundNotice='';
  r.scores={};
  r.players.forEach(p=>{p.hand=[];r.scores[p.id]=0;});
  for(let i=0;i<7;i++)for(const p of r.players)dealOne(p,r);
  r.category=null;
  r.turn=0;
  r.opener=0;
  r.plays=[];
  r.resolvedIds=[];
  broadcast(r);
  sendHands(r);
  send(currentPlayer(r),{type:'notice',message:'Anda pembuka. Pilih satu kad bernombor untuk menentukan golongan kata.'});
}
function finishRound(r){
  const normalPlays=r.plays.filter(x=>x.card.type==='normal');
  if(!normalPlays.length){
    r.roundWinner=null;
    r.roundPoints=0;
    r.roundNotice='Tiada kad bernombor dimainkan dalam pusingan ini.';
  }else{
    const max=Math.max(...normalPlays.map(x=>x.card.number));
    const winners=normalPlays.filter(x=>x.card.number===max);
    const winnerPlay=winners[0];
    r.roundWinner=winnerPlay.playerId;
    r.roundPoints=max;
    // Jika seri, semua pemain dengan nilai tertinggi menerima mata yang sama.
    winners.forEach(x=>{r.scores[x.playerId]=(r.scores[x.playerId]||0)+max;});
    r.roundNotice=winners.length>1
      ? `Seri! ${winners.map(x=>x.name).join(', ')} masing-masing mendapat ${max} mata.`
      : `${winnerPlay.name} menang pusingan dengan ${max} mata.`;
  }

  if(r.round>=TOTAL_ROUNDS){
    const maxScore=Math.max(...r.players.map(p=>r.scores[p.id]||0));
    const winners=r.players.filter(p=>(r.scores[p.id]||0)===maxScore);
    r.winner=winners[0]?.id||null;
    r.roundNotice=winners.length>1
      ? `🏆 SERI! ${winners.map(p=>p.name).join(', ')} memperoleh ${maxScore} mata.`
      : `🏆 ${winners[0]?.name||'Pemain'} ialah JUARA MORFOGO dengan ${maxScore} mata.`;
    broadcast(r);
    sendHands(r);
    return;
  }

  // Pemenang pusingan menjadi pembuka pusingan seterusnya.
  let opener=r.players.findIndex(p=>p.id===r.roundWinner);
  if(opener<0)opener=r.opener;
  r.opener=opener;
  r.round++;
  r.category=null;
  r.plays=[];
  r.resolvedIds=[];
  r.roundWinner=null;
  r.roundPoints=0;
  r.roundNotice='';
  r.turn=r.opener;
  r.players.forEach(p=>dealUpToSeven(p,r));
  broadcast(r);
  sendHands(r);
  send(currentPlayer(r),{type:'notice',message:'Anda pembuka pusingan seterusnya. Pilih satu kad bernombor untuk menentukan golongan kata.'});
}

wss.on('connection',ws=>{
  let player=null,room=null;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return;}

    if(m.type==='create'){
      const target=Math.min(5,Math.max(2,Number(m.target)||2));
      const code=roomCode();
      room={code,targetPlayers:target,players:[],started:false,deck:[],discard:[],turn:0,opener:0,direction:1,category:null,round:0,plays:[],resolvedIds:[],scores:{},roundWinner:null,roundPoints:0,roundNotice:'',winner:null};
      rooms.set(code,room);
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain 1').slice(0,24),hand:[],ws};
      room.players.push(player);room.scores[player.id]=0;
      send(player,{type:'joined',id:player.id,room:code,host:true});
      broadcast(room);return;
    }

    if(m.type==='join'){
      room=rooms.get(String(m.room||'').toUpperCase());
      if(!room)return send({ws},{type:'error',message:'Bilik permainan tidak ditemui.'});
      if(room.started)return send({ws},{type:'error',message:'Permainan sudah bermula.'});
      if(room.players.length>=room.targetPlayers)return send({ws},{type:'error',message:'Bilik sudah penuh.'});
      player={id:crypto.randomUUID(),name:String(m.name||'Pemain').slice(0,24),hand:[],ws};
      room.players.push(player);room.scores[player.id]=0;
      send(player,{type:'joined',id:player.id,room:room.code,host:false});
      broadcast(room);return;
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
      if(room.resolvedIds.includes(player.id))return send(player,{type:'notice',message:'Anda sudah bermain untuk pusingan ini.'});
      const idx=player.hand.findIndex(c=>c.id===m.cardId);if(idx<0)return;
      const card=player.hand[idx];

      // Pemain pembuka mesti memainkan kad bernombor untuk menetapkan kategori.
      if(room.category===null){
        if(card.type==='wild'){
          if(!categories.includes(m.category))return send(player,{type:'notice',message:'Pilih golongan kata baharu.'});
          player.hand.splice(idx,1);room.discard.push(card);
          chooseCategory(room,m.category);
          room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true,chosenCategory:m.category});
        }else if(card.type==='normal'){
          player.hand.splice(idx,1);room.discard.push(card);room.category=card.category;
          room.plays.push({playerId:player.id,name:player.name,card,score:card.number});
        }else{
          return send(player,{type:'notice',message:'Sebagai pembuka, pilih kad bernombor yang mempunyai contoh kata dan golongan kata.'});
        }
        markResolved(room,player.id);
        if(allResolved(room))finishRound(room);else{room.turn=findNextUnresolved(room);broadcast(room);sendHands(room);}
        return;
      }

      if(card.type==='normal'){
        if(card.category!==room.category)return send(player,{type:'notice',message:`Tiada padanan. Anda perlu pilih kad ${room.category} atau tekan “Ambil 1 Kad”.`});
        player.hand.splice(idx,1);room.discard.push(card);
        room.plays.push({playerId:player.id,name:player.name,card,score:card.number});
        markResolved(room,player.id);
        if(allResolved(room))finishRound(room);else{room.turn=findNextUnresolved(room);broadcast(room);sendHands(room);}
        return;
      }

      if(card.type==='wild'){
        if(!categories.includes(m.category))return send(player,{type:'notice',message:'Pilih golongan kata baharu.'});
        player.hand.splice(idx,1);room.discard.push(card);chooseCategory(room,m.category);
        room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true,chosenCategory:m.category});
        markResolved(room,player.id);
        if(allResolved(room))finishRound(room);else{room.turn=findNextUnresolved(room);broadcast(room);sendHands(room);}
        return;
      }

      if(card.type==='draw2'){
        player.hand.splice(idx,1);room.discard.push(card);
        room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        markResolved(room,player.id);
        const targetIndex=findNextUnresolved(room,room.turn);
        if(targetIndex>=0){
          const target=room.players[targetIndex];
          dealOne(target,room);dealOne(target,room);
          markResolved(room,target.id);
          room.plays.push({playerId:target.id,name:target.name,card:{id:'penalty-'+target.id,type:'penalty',category:null,number:null,word:'+2 DITERIMA'},score:0,special:true,skipped:true});
          send(target,{type:'notice',message:'Kad +2! Anda menerima 2 kad dan giliran anda dilangkau.'});
          room.turn=findNextUnresolved(room,targetIndex);
        }
        if(allResolved(room))finishRound(room);else{broadcast(room);sendHands(room);}
        return;
      }

      if(card.type==='skip'){
        player.hand.splice(idx,1);room.discard.push(card);
        room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        markResolved(room,player.id);
        const skippedIndex=findNextUnresolved(room,room.turn);
        if(skippedIndex>=0){
          const skipped=room.players[skippedIndex];
          markResolved(room,skipped.id);
          room.plays.push({playerId:skipped.id,name:skipped.name,card:{id:'skip-'+skipped.id,type:'penalty',category:null,number:null,word:'DILANGKAU'},score:0,special:true,skipped:true});
          send(skipped,{type:'notice',message:'Giliran anda dilangkau oleh kad LANGKAU.'});
          room.turn=findNextUnresolved(room,skippedIndex);
        }
        if(allResolved(room))finishRound(room);else{broadcast(room);sendHands(room);}
        return;
      }

      if(card.type==='reverse'){
        player.hand.splice(idx,1);room.discard.push(card);
        room.plays.push({playerId:player.id,name:player.name,card,score:0,special:true});
        markResolved(room,player.id);
        room.direction*=-1;
        room.turn=findNextUnresolved(room,room.turn);
        if(allResolved(room))finishRound(room);else{broadcast(room);sendHands(room);}
        return;
      }
    }

    if(m.type==='draw'){
      if(room.players[room.turn]?.id!==player.id)return send(player,{type:'notice',message:'Bukan giliran anda.'});
      if(room.resolvedIds.includes(player.id))return send(player,{type:'notice',message:'Anda sudah selesai untuk pusingan ini.'});
      if(room.category===null)return send(player,{type:'notice',message:'Pemain pembuka perlu memilih kad terlebih dahulu.'});
      const hasMatch=player.hand.some(c=>c.type==='normal'&&c.category===room.category);
      if(hasMatch)return send(player,{type:'notice',message:`Anda masih mempunyai kad ${room.category}. Pilih kad itu atau gunakan kad special.`});
      dealOne(player,room);
      markResolved(room,player.id);
      send(player,{type:'notice',message:'Tiada kad golongan kata yang sepadan. Anda mengambil 1 kad. Giliran diteruskan.'});
      if(allResolved(room))finishRound(room);else{room.turn=findNextUnresolved(room);broadcast(room);sendHands(room);}
      return;
    }
  });

  ws.on('close',()=>{
    if(room&&player){
      const i=room.players.findIndex(p=>p.id===player.id);
      if(i>=0)room.players.splice(i,1);
      if(!room.players.length)rooms.delete(room.code);
      else{
        if(room.turn>=room.players.length)room.turn=0;
        broadcast(room);
      }
    }
  });
});

server.listen(PORT,()=>console.log(`MorfoGo running on ${PORT}`));
