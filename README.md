# MorfoGo — Permainan Bahasa Melayu

Multiplayer web game untuk sehingga 5 peranti melalui satu link bilik.

## Deploy cepat ke Render
1. Upload folder ini ke GitHub sebagai satu repository.
2. Di Render, pilih **New > Web Service** dan sambungkan repository.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Selepas deploy, Render memberikan satu URL `https://...onrender.com` yang boleh dikongsi kepada semua pemain.

Aplikasi menggunakan Node.js + Express + WebSocket. Tiada database diperlukan untuk satu sesi permainan; data bilik berada dalam memori server.
