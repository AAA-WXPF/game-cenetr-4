import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '../ui/Button';
import { playSound } from '../../utils/sound';
import { User, MatchDetails } from '../../types';

interface Props {
  user: User;
  onGameEnd: (points: number, isWin?: boolean, details?: MatchDetails) => void;
  player2?: User | null;
  onOpenP2Login?: () => void;
}

// --- Engine Constants ---
const TILE_SIZE = 20; 
const GRID_COUNT = 25; 
const CANVAS_SIZE = TILE_SIZE * GRID_COUNT; // 500px
const GAME_SPEED_START = 150; 
const GAME_SPEED_MIN = 60; 

// Types
type Point = { x: number; y: number };
type Particle = { 
  x: number; y: number; 
  vx: number; vy: number; 
  life: number; 
  color: string; 
  size: number;
};

export const Snake: React.FC<Props> = ({ user, onGameEnd }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // UI State
  const [gameState, setGameState] = useState<'SETUP' | 'PLAYING' | 'GAMEOVER'>('SETUP');
  const [score, setScore] = useState(0);

  // Engine State (Refs for Loop)
  const statusRef = useRef<'SETUP' | 'PLAYING' | 'GAMEOVER'>('SETUP');
  const snake = useRef<Point[]>([]);
  const food = useRef<Point>({ x: 15, y: 15 });
  const direction = useRef<Point>({ x: 0, y: -1 }); 
  const nextMoves = useRef<Point[]>([]); 
  const particles = useRef<Particle[]>([]); 
  
  const speed = useRef(GAME_SPEED_START);
  const timeAccumulator = useRef(0);
  const lastTime = useRef(0);
  const reqId = useRef<number>(0);
  const frameTick = useRef(0);

  // Sync React state to Ref for use in loop
  useEffect(() => {
      statusRef.current = gameState;
  }, [gameState]);

  // --- Initialization ---
  const initBoard = useCallback(() => {
    const startX = 12;
    const startY = 15;
    snake.current = [
      { x: startX, y: startY },
      { x: startX, y: startY + 1 },
      { x: startX, y: startY + 2 },
    ];
    direction.current = { x: 0, y: -1 };
    nextMoves.current = [];
    particles.current = [];
    spawnFood(snake.current);
  }, []);

  const spawnFood = (currentSnake: Point[]) => {
    let valid = false;
    let newFood = { x: 0, y: 0 };
    while (!valid) {
      newFood = {
        x: Math.floor(Math.random() * GRID_COUNT),
        y: Math.floor(Math.random() * GRID_COUNT)
      };
      valid = !currentSnake.some(s => s.x === newFood.x && s.y === newFood.y);
    }
    food.current = newFood;
  };

  const spawnParticles = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = Math.random() * 5 + 2;
      particles.current.push({
        x: x * TILE_SIZE + TILE_SIZE / 2,
        y: y * TILE_SIZE + TILE_SIZE / 2,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 1.0,
        color: color,
        size: Math.random() * 3 + 2
      });
    }
  };

  const updateParticles = () => {
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.03; 
      p.size *= 0.96; 
      if (p.life <= 0) particles.current.splice(i, 1);
    }
  };

  const startGame = () => {
    initBoard();
    speed.current = GAME_SPEED_START;
    setScore(0);
    timeAccumulator.current = 0;
    setGameState('PLAYING');
    playSound.click();
  };

  const handleGameOver = () => {
    playSound.lose();
    setGameState('GAMEOVER');
    onGameEnd(score, true, {
        opponent: 'System',
        score: `${score} 分`,
        matchTags: ['Snake Solo']
    });
  };

  const update = () => {
    if (nextMoves.current.length > 0) {
      const nextDir = nextMoves.current.shift()!;
      if (direction.current.x + nextDir.x !== 0 || direction.current.y + nextDir.y !== 0) {
        direction.current = nextDir;
      }
    }

    const head = snake.current[0];
    const newHead = { x: head.x + direction.current.x, y: head.y + direction.current.y };

    if (newHead.x < 0 || newHead.x >= GRID_COUNT || newHead.y < 0 || newHead.y >= GRID_COUNT) {
      handleGameOver();
      return;
    }
    
    if (snake.current.some(s => s.x === newHead.x && s.y === newHead.y)) {
      handleGameOver();
      return;
    }

    snake.current.unshift(newHead);

    if (newHead.x === food.current.x && newHead.y === food.current.y) {
      playSound.capture();
      setScore(s => {
        const ns = s + 10;
        if (ns % 50 === 0) speed.current = Math.max(GAME_SPEED_MIN, speed.current * 0.92);
        return ns;
      });
      spawnParticles(newHead.x, newHead.y, '#10b981');
      spawnFood(snake.current);
    } else {
      snake.current.pop();
    }
  };

  const render = (ctx: CanvasRenderingContext2D) => {
    const dpr = window.devicePixelRatio || 1;
    // 重置变换，防止 High DPI 下缩放不断累加导致画面消失
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#020617'; 
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    // Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for(let i=0; i<=GRID_COUNT; i++) {
        ctx.moveTo(i * TILE_SIZE, 0); ctx.lineTo(i * TILE_SIZE, CANVAS_SIZE);
        ctx.moveTo(0, i * TILE_SIZE); ctx.lineTo(CANVAS_SIZE, i * TILE_SIZE);
    }
    ctx.stroke();

    // Food
    const fx = food.current.x * TILE_SIZE;
    const fy = food.current.y * TILE_SIZE;
    const pulse = Math.sin(frameTick.current * 0.1) * 3;
    ctx.shadowColor = '#f43f5e';
    ctx.shadowBlur = 15 + pulse;
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.roundRect(fx + 4 - pulse/2, fy + 4 - pulse/2, TILE_SIZE - 8 + pulse, TILE_SIZE - 8 + pulse, 6);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Snake
    snake.current.forEach((seg, i) => {
      const isHead = i === 0;
      const x = seg.x * TILE_SIZE;
      const y = seg.y * TILE_SIZE;
      
      ctx.fillStyle = isHead ? '#10b981' : '#059669';
      if (isHead) {
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 10;
      }
      
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2, isHead ? 6 : 4);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Particles
    particles.current.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    });
  };

  const loop = useCallback((time: number) => {
    const dt = time - lastTime.current;
    lastTime.current = time;
    frameTick.current++;
    updateParticles();

    if (statusRef.current === 'PLAYING') {
        timeAccumulator.current += dt;
        if (timeAccumulator.current >= speed.current) {
            update();
            timeAccumulator.current = 0;
        }
    }

    const canvas = canvasRef.current;
    if (canvas) {
       const ctx = canvas.getContext('2d');
       if (ctx) render(ctx);
    }
    reqId.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    initBoard();
    lastTime.current = performance.now();
    reqId.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(reqId.current);
  }, [initBoard, loop]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (statusRef.current !== 'PLAYING') return;
      const key = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();

      const map: Record<string, Point> = {
          'w': {x: 0, y: -1}, 'arrowup': {x: 0, y: -1},
          's': {x: 0, y: 1},  'arrowdown': {x: 0, y: 1},
          'a': {x: -1, y: 0}, 'arrowleft': {x: -1, y: 0},
          'd': {x: 1, y: 0},  'arrowright': {x: 1, y: 0}
      };

      const desiredDir = map[key];
      if (!desiredDir) return;

      const lastDir = nextMoves.current.length > 0 
          ? nextMoves.current[nextMoves.current.length - 1] 
          : direction.current;

      if (lastDir.x + desiredDir.x !== 0 || lastDir.y + desiredDir.y !== 0) {
          if (nextMoves.current.length < 2) nextMoves.current.push(desiredDir);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
     const canvas = canvasRef.current;
     if (canvas) {
         const dpr = window.devicePixelRatio || 1;
         canvas.width = CANVAS_SIZE * dpr;
         canvas.height = CANVAS_SIZE * dpr;
         canvas.style.width = `${CANVAS_SIZE}px`;
         canvas.style.height = `${CANVAS_SIZE}px`;
     }
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-4 overflow-hidden">
      <div className="bg-slate-900/90 backdrop-blur-2xl p-6 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10 w-full max-w-lg flex flex-col items-center relative animate-zoom-in">
        <div className="w-full flex justify-between items-center mb-6">
            <div>
                <h2 className="text-2xl font-black text-emerald-400 tracking-tighter">SNAKE PRO</h2>
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">LV.{(Math.floor(score/100) + 1)} Survival</div>
            </div>
            <div className="text-right">
                <div className="text-4xl font-black text-white font-mono leading-none">{score}</div>
                <div className="text-[10px] text-slate-500 font-bold tracking-widest mt-1">SCORE</div>
            </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border-4 border-slate-800 bg-black">
            <canvas ref={canvasRef} className="block cursor-none" />
            {gameState !== 'PLAYING' && (
                <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center text-center p-8 z-20 backdrop-blur-md animate-fade-in">
                    {gameState === 'SETUP' ? (
                        <>
                            <div className="text-7xl mb-6">🐍</div>
                            <h3 className="text-3xl font-black text-white mb-6 tracking-tight">READY?</h3>
                            <Button onClick={startGame} className="px-12 py-4 text-xl bg-emerald-600 hover:bg-emerald-500 rounded-2xl">START GAME</Button>
                        </>
                    ) : (
                        <div className="animate-zoom-in">
                            <div className="text-6xl mb-4">💀</div>
                            <h3 className="text-4xl font-black text-red-500 mb-2">WASTED</h3>
                            <div className="bg-white/5 p-4 rounded-xl mb-6 w-full border border-white/10">
                                <p className="text-6xl font-black text-white font-mono">{score}</p>
                            </div>
                            <Button onClick={startGame} className="w-full py-3 text-lg bg-emerald-600 hover:bg-emerald-500">RETRY</Button>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};