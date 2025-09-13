const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Расширенная CORS конфигурация
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
  credentials: true
}));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Простой endpoint для проверки
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Crash Game Server is running' });
});

let gameState = {
  state: 'waiting',
  multiplier: 1.00,
  startTime: null,
  crashTime: null,
  countdown: 5,
  players: new Map(),
  history: []
};

let countdownInterval = null;
let gameInterval = null;

// Socket.IO с настройками для Vercel
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Поддержка обоих методов
  allowEIO3: true, // Совместимость
  pingTimeout: 60000,
  pingInterval: 25000
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.emit('gameState', {
    state: gameState.state,
    multiplier: gameState.multiplier,
    countdown: gameState.countdown,
    players: Array.from(gameState.players.values())
  });
  
  socket.on('joinGame', (data) => {
    const player = {
      id: socket.id,
      userId: data.userId || socket.id,
      name: data.userName || 'Player',
      bet: 0,
      status: 'waiting',
      winAmount: 0
    };
    
    gameState.players.set(socket.id, player);
    io.emit('playersUpdate', Array.from(gameState.players.values()));
  });
  
  socket.on('placeBet', (data) => {
    if (gameState.state !== 'waiting' && gameState.state !== 'counting') {
      return;
    }
    
    const player = gameState.players.get(socket.id);
    if (player) {
      player.bet = data.amount;
      player.status = 'betting';
      gameState.players.set(socket.id, player);
      
      io.emit('playersUpdate', Array.from(gameState.players.values()));
      
      if (gameState.state === 'waiting' && gameState.players.size >= 1) {
        startCountdown();
      }
    }
  });
  
  socket.on('cashOut', () => {
    if (gameState.state !== 'running') {
      return;
    }
    
    const player = gameState.players.get(socket.id);
    if (player && player.status === 'betting') {
      const winAmount = Math.floor(player.bet * gameState.multiplier);
      player.status = 'cashed-out';
      player.winAmount = winAmount;
      gameState.players.set(socket.id, player);
      
      io.emit('playerCashedOut', { 
        playerId: socket.id, 
        multiplier: gameState.multiplier,
        winAmount: winAmount
      });
      io.emit('playersUpdate', Array.from(gameState.players.values()));
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    gameState.players.delete(socket.id);
    io.emit('playersUpdate', Array.from(gameState.players.values()));
  });
});

function startCountdown() {
  if (gameState.state !== 'waiting') return;
  
  gameState.state = 'counting';
  gameState.countdown = 5;
  
  io.emit('countdownStarted', gameState.countdown);
  
  countdownInterval = setInterval(() => {
    gameState.countdown--;
    io.emit('countdownUpdate', gameState.countdown);
    
    if (gameState.countdown <= 0) {
      clearInterval(countdownInterval);
      startGame();
    }
  }, 1000);
}

function startGame() {
  gameState.state = 'running';
  gameState.startTime = Date.now();
  gameState.crashTime = Math.random() * 25 + 5;
  gameState.multiplier = 1.00;
  
  io.emit('gameStarted');
  
  gameInterval = setInterval(() => {
    const elapsed = (Date.now() - gameState.startTime) / 1000;
    gameState.multiplier = Math.pow(Math.E, 0.05 * elapsed);
    
    io.emit('multiplierUpdate', gameState.multiplier);
    
    if (elapsed >= gameState.crashTime) {
      crashGame();
    }
  }, 50);
}

function crashGame() {
  clearInterval(gameInterval);
  gameState.state = 'crashed';
  
  gameState.players.forEach((player, id) => {
    if (player.status === 'betting') {
      player.status = 'lost';
      gameState.players.set(id, player);
    }
  });
  
  io.emit('gameCrashed', {
    multiplier: gameState.multiplier,
    players: Array.from(gameState.players.values())
  });
  
  gameState.history.unshift({
    multiplier: gameState.multiplier.toFixed(2) + 'x',
    timestamp: new Date().toISOString()
  });
  
  if (gameState.history.length > 20) {
    gameState.history.pop();
  }
  
  setTimeout(() => {
    resetGame();
  }, 5000);
}

function resetGame() {
  gameState.state = 'waiting';
  gameState.multiplier = 1.00;
  gameState.startTime = null;
  gameState.crashTime = null;
  gameState.countdown = 5;
  
  gameState.players.forEach((player, id) => {
    player.status = 'waiting';
    player.bet = 0;
    player.winAmount = 0;
    gameState.players.set(id, player);
  });
  
  io.emit('gameReset', Array.from(gameState.players.values()));
}

// ВАЖНО: Для Vercel нужно экспортировать app
const PORT = process.env.PORT || 3000;

// Только для локальной разработки
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
