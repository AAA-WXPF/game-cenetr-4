import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '../ui/Button';
import { playSound } from '../../utils/sound';
import { User, GameType, MatchDetails } from '../../types';
import { StreakIndicator } from '../ui/StreakIndicator';

interface Props {
  user: User;
  onGameEnd: (points: number, isWin?: boolean, details?: MatchDetails) => void;
  player2?: User | null;
  onOpenP2Login?: () => void;
}

type BilliardsMode = '8BALL' | '9BALL';
type GroupType = 'SOLIDS' | 'STRIPES' | null;

// --- Physics Constants ---
const TABLE_WIDTH = 800;
const TABLE_HEIGHT = 400;
const BALL_RADIUS = 12; 
const POCKET_RADIUS = 28; 

const SUB_STEPS = 8; 
const DECELERATION = 0.045;
const WALL_BOUNCE = 0.75;
const BALL_RESTITUTION = 0.92; 
const MAX_POWER = 45;
const STOP_THRESHOLD = 0.08;

const BALL_COLORS = [
  '#f0f0f0', '#fbbf24', '#2563eb', '#dc2626', '#7e22ce', '#f97316', '#16a34a', '#881337', 
  '#111111', '#fbbf24', '#2563eb', '#dc2626', '#7e22ce', '#f97316', '#16a34a', '#881337'
];

const POCKETS = [
  { x: 0, y: 0 }, { x: TABLE_WIDTH / 2, y: -8 }, { x: TABLE_WIDTH, y: 0 },
  { x: 0, y: TABLE_HEIGHT }, { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT + 8 }, { x: TABLE_WIDTH, y: TABLE_HEIGHT }
];

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean; 
  type: 'CUE' | 'SOLID' | 'STRIPE' | 'EIGHT' | 'NINE';
}

export const Billiards: React.FC<Props> = ({ user, onGameEnd, player2, onOpenP2Login }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<BilliardsMode>('8BALL');
  const [gameState, setGameState] = useState<'SETUP' | 'PLAYING' | 'ROUND_OVER' | 'GAMEOVER'>('SETUP');
  const [matchConfig, setMatchConfig] = useState({ totalFrames: 3, pointsPerMatch: 100 });
  const [matchScore, setMatchScore] = useState({ p1: 0, p2: 0 });
  const [turn, setTurn] = useState<1 | 2>(1);
  const [winner, setWinner] = useState<string | null>(null); 
  const [matchWinner, setMatchWinner] = useState<string | null>(null);
  const [playerGroups, setPlayerGroups] = useState<{1: GroupType, 2: GroupType}>({ 1: null, 2: null });
  const [isMoving, setIsMoving] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [currentDrag, setCurrentDrag] = useState<{x: number, y: number} | null>(null);
  const [power, setPower] = useState(0);
  const [placingBall, setPlacingBall] = useState(false);
  const [validPlacement, setValidPlacement] = useState(true);
  const [foulMessage, setFoulMessage] = useState<string | null>(null);

  const ballsRef = useRef<Ball[]>([]);
  const requestRef = useRef<number>(0);
  const soundCooldowns = useRef<Record<string, number>>({}); 
  const turnInfoRef = useRef({ pottedThisTurn: false, firstHitId: null as number | null, nineBallPotted: false });

  // Refs for consistent access within the physics loop (avoids stale closures)
  const modeRef = useRef(mode);
  const turnRef = useRef(turn);
  const playerGroupsRef = useRef(playerGroups);
  const placingBallRef = useRef(placingBall);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { turnRef.current = turn; }, [turn]);
  useEffect(() => { playerGroupsRef.current = playerGroups; }, [playerGroups]);
  useEffect(() => { placingBallRef.current = placingBall; }, [placingBall]);

  const endRound = (roundWinnerName: string) => {
      playSound.win();
      const newScore = { ...matchScore };
      if (roundWinnerName === 'P1' || roundWinnerName === user.username) newScore.p1 += 1;
      else newScore.p2 += 1;
      
      setMatchScore(newScore);
      setWinner(roundWinnerName);

      const targetWins = Math.ceil(matchConfig.totalFrames / 2);
      if (newScore.p1 >= targetWins) {
          setMatchWinner('P1');
          setGameState('GAMEOVER');
          onGameEnd(matchConfig.pointsPerMatch, true, { opponent: player2?.username || 'Player 2', score: `${newScore.p1}-${newScore.p2}`, matchTags: [mode, `BO${matchConfig.totalFrames}`] });
      } else if (newScore.p2 >= targetWins) {
          setMatchWinner('P2');
          setGameState('GAMEOVER');
          onGameEnd(-matchConfig.pointsPerMatch, false, { opponent: player2?.username || 'Player 2', score: `${newScore.p1}-${newScore.p2}`, matchTags: [mode, `BO${matchConfig.totalFrames}`] });
      } else {
          setGameState('ROUND_OVER');
      }
  };

  const initRound = () => {
    const newBalls: Ball[] = [];
    newBalls.push({ id: 0, x: 200, y: TABLE_HEIGHT / 2, vx: 0, vy: 0, active: true, type: 'CUE' });
    const startX = 600, startY = TABLE_HEIGHT / 2, r = BALL_RADIUS;
    const dist = Math.sqrt((2 * r) ** 2 - r ** 2) + 0.5;

    if (mode === '8BALL') {
        const pattern = [[1], [2, 9], [3, 8, 10], [4, 15, 12, 5], [6, 7, 13, 14, 11]];
        pattern.forEach((row, colIndex) => {
            row.forEach((id, rowIndex) => {
                 const x = startX + colIndex * dist, y = startY + (rowIndex * 2 * r) - (row.length - 1) * r;
                 newBalls.push({ id, x: x + Math.random()*0.1, y: y + Math.random()*0.1, vx: 0, vy: 0, active: true, type: id === 8 ? 'EIGHT' : id > 8 ? 'STRIPE' : 'SOLID' });
            });
        });
    } else {
        const ids = [1, 2, 3, 9, 5, 6, 7, 8, 4], pos = [{c:0,r:0},{c:1,r:-0.5},{c:1,r:0.5},{c:2,r:0},{c:2,r:-1},{c:2,r:1},{c:3,r:-0.5},{c:3,r:0.5},{c:4,r:0}];
        pos.forEach((p, i) => {
            const id = ids[i], x = startX + p.c * dist, y = startY + p.r * 2 * r;
            newBalls.push({ id, x: x + Math.random()*0.1, y: y + Math.random()*0.1, vx: 0, vy: 0, active: true, type: id === 9 ? 'NINE' : 'SOLID' });
        });
    }
    ballsRef.current = newBalls;
    setGameState('PLAYING');
    setTurn(1); setWinner(null); setPlacingBall(false); setFoulMessage(null); setPlayerGroups({ 1: null, 2: null });
    turnInfoRef.current = { pottedThisTurn: false, firstHitId: null, nineBallPotted: false };
  };

  const startMatch = (selectedMode: BilliardsMode) => {
    if (user.username !== '测试玩家' && !player2 && onOpenP2Login) { onOpenP2Login(); return; }
    playSound.click();
    setMode(selectedMode);
    setMatchScore({ p1: 0, p2: 0 });
    setMatchWinner(null);
    initRound();
  };

  const handlePotLogic = (ids: number[]) => {
    if (ids.includes(0)) return;
    const currentMode = modeRef.current;
    const currentTurn = turnRef.current;
    const currentGroups = playerGroupsRef.current;

    if (currentMode === '8BALL' && currentGroups[1] === null) {
        const first = ids.find(id => id !== 0 && id !== 8);
        if (first) {
            const type: GroupType = first < 8 ? 'SOLIDS' : 'STRIPES';
            const other: GroupType = first < 8 ? 'STRIPES' : 'SOLIDS';
            setPlayerGroups({ 1: currentTurn === 1 ? type : other, 2: currentTurn === 2 ? type : other });
        }
    }
    if (currentMode === '8BALL' && ids.includes(8)) {
        const active = ballsRef.current.filter(b => b.active && b.id !== 0 && b.id !== 8);
        endRound(active.length === 0 && turnInfoRef.current.firstHitId ? (currentTurn === 1 ? 'P1' : 'P2') : (currentTurn === 1 ? 'P2' : 'P1'));
    }
  };

  const handleTurnEnd = () => {
    let foul: string | null = null;
    const cue = ballsRef.current.find(b => b.id === 0);
    const currentMode = modeRef.current;
    const currentTurn = turnRef.current;
    const currentGroups = playerGroupsRef.current;
    
    if (!cue || !cue.active) {
        foul = "母球落袋"; 
        if (cue) { cue.active = true; cue.vx = 0; cue.vy = 0; }
        setPlacingBall(true);
    } else if (turnInfoRef.current.firstHitId === null) {
        foul = "未击中任何球"; setPlacingBall(true);
    } else if (currentMode === '9BALL') {
        const lowest = ballsRef.current.reduce((m, b) => (b.id !== 0 && b.active && b.id < m) ? b.id : m, 999);
        if (turnInfoRef.current.firstHitId !== lowest) { foul = "未击中最小号码球"; setPlacingBall(true); }
    } else if (currentMode === '8BALL' && currentGroups[currentTurn]) {
        const first = ballsRef.current.find(b => b.id === turnInfoRef.current.firstHitId);
        if (first) {
            const hitGroup: GroupType | 'EIGHT' = first.id < 8 ? 'SOLIDS' : first.id > 8 ? 'STRIPES' : 'EIGHT';
            const onEight = ballsRef.current.filter(b => b.active && b.id !== 0 && b.id !== 8 && ((b.id < 8 && currentGroups[currentTurn] === 'SOLIDS') || (b.id > 8 && currentGroups[currentTurn] === 'STRIPES'))).length === 0;
            if (onEight ? first.id !== 8 : hitGroup !== currentGroups[currentTurn]) { 
                foul = onEight ? "必须击打黑8" : "未击中本方目标球"; 
                setPlacingBall(true); 
            }
        }
    }

    if (foul) {
        setFoulMessage(`犯规: ${foul}`); playSound.wrong(); setTurn(currentTurn === 1 ? 2 : 1);
    } else {
        if (turnInfoRef.current.pottedThisTurn) {
             if (currentMode === '9BALL' && turnInfoRef.current.nineBallPotted) { endRound(currentTurn === 1 ? 'P1' : 'P2'); return; }
             playSound.click(); 
        } else { setTurn(currentTurn === 1 ? 2 : 1); }
    }
    turnInfoRef.current = { pottedThisTurn: false, firstHitId: null, nineBallPotted: false };
    if (foul) setTimeout(() => setFoulMessage(null), 2000);
  };

  const updatePhysics = () => {
      let moving = false;
      const balls = ballsRef.current, potted: number[] = [];
      for (let s = 0; s < SUB_STEPS; s++) {
          balls.forEach(b => {
              if (!b.active || (placingBallRef.current && b.id === 0)) return;
              b.x += b.vx / SUB_STEPS; b.y += b.vy / SUB_STEPS;
              const spd = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
              if (spd > 0) {
                  const nSpd = Math.max(0, spd - DECELERATION/SUB_STEPS);
                  if (nSpd < STOP_THRESHOLD) { b.vx = 0; b.vy = 0; } else { b.vx *= nSpd/spd; b.vy *= nSpd/spd; moving = true; }
              }
              if (b.x < BALL_RADIUS) { b.x = BALL_RADIUS; b.vx = Math.abs(b.vx)*WALL_BOUNCE; }
              if (b.x > TABLE_WIDTH - BALL_RADIUS) { b.x = TABLE_WIDTH - BALL_RADIUS; b.vx = -Math.abs(b.vx)*WALL_BOUNCE; }
              if (b.y < BALL_RADIUS) { b.y = BALL_RADIUS; b.vy = Math.abs(b.vy)*WALL_BOUNCE; }
              if (b.y > TABLE_HEIGHT - BALL_RADIUS) { b.y = TABLE_HEIGHT - BALL_RADIUS; b.vy = -Math.abs(b.vy)*WALL_BOUNCE; }
              if (POCKETS.some(p => (b.x-p.x)**2 + (b.y-p.y)**2 < (POCKET_RADIUS*1.2)**2)) {
                  b.active = false; b.vx = 0; b.vy = 0; potted.push(b.id);
                  if (b.id === 9) turnInfoRef.current.nineBallPotted = true;
                  playSound.billiardPocket();
              }
          });
          for (let i = 0; i < balls.length; i++) {
              for (let j = i + 1; j < balls.length; j++) {
                  const b1 = balls[i], b2 = balls[j];
                  if (!b1.active || !b2.active || (placingBallRef.current && (b1.id === 0 || b2.id === 0))) continue;
                  const dx = b2.x-b1.x, dy = b2.y-b1.y, d2 = dx*dx + dy*dy;
                  if (d2 < (BALL_RADIUS*2)**2) {
                      const d = Math.sqrt(d2), nx = dx/d, ny = dy/d, corr = (BALL_RADIUS*2-d)*0.5;
                      b1.x -= nx*corr; b1.y -= ny*corr; b2.x += nx*corr; b2.y += ny*corr;
                      const v1n = b1.vx*nx + b1.vy*ny, v2n = b2.vx*nx + b2.vy*ny;
                      const tx = -ny, ty = nx, v1t = b1.vx*tx + b1.vy*ty, v2t = b2.vx*tx + b2.vy*ty;
                      const v1nn = (v1n*(1-BALL_RESTITUTION) + v2n*(1+BALL_RESTITUTION))/2;
                      const v2nn = (v1n*(1+BALL_RESTITUTION) + v2n*(1-BALL_RESTITUTION))/2;
                      b1.vx = v1nn*nx + v1t*tx; b1.vy = v1nn*ny + v1t*ty;
                      b2.vx = v2nn*nx + v2t*tx; b2.vy = v2nn*ny + v2t*ty;
                      if (b1.id === 0 && turnInfoRef.current.firstHitId === null) turnInfoRef.current.firstHitId = b2.id;
                      if (b2.id === 0 && turnInfoRef.current.firstHitId === null) turnInfoRef.current.firstHitId = b1.id;
                  }
              }
          }
      }
      if (potted.length > 0) { turnInfoRef.current.pottedThisTurn = true; handlePotLogic(potted); }
      setIsMoving(moving);
      if (!moving && isMoving) handleTurnEnd();
  };

  const render = useCallback(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext('2d'), balls = ballsRef.current; if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const scale = Math.min(canvas.width / TABLE_WIDTH, canvas.height / TABLE_HEIGHT);
      const ox = (canvas.width - TABLE_WIDTH*scale)/2, oy = (canvas.height - TABLE_HEIGHT*scale)/2;
      ctx.fillStyle = '#15803d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(ox, oy); ctx.scale(scale, scale);
      ctx.strokeStyle = '#3f2c22'; ctx.lineWidth = 20; ctx.strokeRect(-10, -10, TABLE_WIDTH+20, TABLE_HEIGHT+20);
      ctx.fillStyle = '#111'; POCKETS.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_RADIUS, 0, Math.PI*2); ctx.fill(); });
      balls.forEach(b => {
          if (!b.active) return;
          ctx.beginPath(); ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI*2); ctx.fillStyle = BALL_COLORS[b.id]; ctx.fill();
          if (b.id > 8) { ctx.beginPath(); ctx.arc(b.x, b.y, BALL_RADIUS*0.7, 0, Math.PI*2); ctx.fillStyle = '#fff'; ctx.fill(); }
          if (b.id !== 0) {
              ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
              ctx.fillStyle = '#000'; ctx.font = 'bold 5px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.id.toString(), b.x, b.y);
          }
      });
      if (dragStart && currentDrag) {
          const cue = balls.find(b => b.id === 0);
          if (cue && cue.active) {
              ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(cue.x + (dragStart.x - currentDrag.x), cue.y + (dragStart.y - currentDrag.y));
              ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + power/MAX_POWER})`; ctx.lineWidth = 3; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
          }
      }
      if (placingBall) {
          ctx.strokeStyle = validPlacement ? '#4ade80' : '#ef4444'; ctx.lineWidth = 2;
          ctx.beginPath(); const cue = balls.find(b => b.id === 0); if (cue) { ctx.arc(cue.x, cue.y, BALL_RADIUS+4, 0, Math.PI*2); ctx.stroke(); }
      }
  }, [dragStart, currentDrag, placingBall, validPlacement, power]);

  useEffect(() => {
      const loop = () => { updatePhysics(); render(); requestRef.current = requestAnimationFrame(loop); };
      requestRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(requestRef.current);
  }, [render]);

  const getTablePos = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 };
      const r = canvas.getBoundingClientRect(), sx = canvas.width/r.width, sy = canvas.height/r.height;
      const s = Math.min(canvas.width/TABLE_WIDTH, canvas.height/TABLE_HEIGHT);
      return { x: ((clientX-r.left)*sx - (canvas.width-TABLE_WIDTH*s)/2)/s, y: ((clientY-r.top)*sy - (canvas.height-TABLE_HEIGHT*s)/2)/s };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
      if (isMoving || gameState !== 'PLAYING') return;
      const pos = getTablePos('touches' in e ? e.touches[0].clientX : e.clientX, 'touches' in e ? e.touches[0].clientY : e.clientY);
      if (placingBall) {
          let v = pos.x >= BALL_RADIUS && pos.x <= TABLE_WIDTH-BALL_RADIUS && pos.y >= BALL_RADIUS && pos.y <= TABLE_HEIGHT-BALL_RADIUS;
          if (v && ballsRef.current.some(b => b.id !== 0 && b.active && (b.x-pos.x)**2 + (b.y-pos.y)**2 < (BALL_RADIUS*2)**2)) v = false;
          if (v) { const cue = ballsRef.current.find(b => b.id === 0); if (cue) { cue.x = pos.x; cue.y = pos.y; setPlacingBall(false); playSound.click(); } } else playSound.wrong();
          return;
      }
      setDragStart(pos); setCurrentDrag(pos); setPower(0);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getTablePos('touches' in e ? e.touches[0].clientX : e.clientX, 'touches' in e ? e.touches[0].clientY : e.clientY);
    if (placingBall) {
        let v = pos.x >= BALL_RADIUS && pos.x <= TABLE_WIDTH-BALL_RADIUS && pos.y >= BALL_RADIUS && pos.y <= TABLE_HEIGHT-BALL_RADIUS;
        if (v && ballsRef.current.some(b => b.id !== 0 && b.active && (b.x-pos.x)**2 + (b.y-pos.y)**2 < (BALL_RADIUS*2)**2)) v = false;
        setValidPlacement(v); const cue = ballsRef.current.find(b => b.id === 0); if (cue) { cue.x = pos.x; cue.y = pos.y; } return;
    }
    if (!dragStart) return;
    setCurrentDrag(pos); const d = Math.sqrt((dragStart.x-pos.x)**2 + (dragStart.y-pos.y)**2); setPower(Math.min(d*0.25, MAX_POWER));
  };

  const handleMouseUp = () => {
    if (placingBall || !dragStart || !currentDrag) return;
    const dx = dragStart.x - currentDrag.x, dy = dragStart.y - currentDrag.y, d = Math.sqrt(dx*dx + dy*dy);
    if (d > 5) {
        const p = Math.min(d*0.25, MAX_POWER), a = Math.atan2(dy, dx), cue = ballsRef.current.find(b => b.id === 0);
        if (cue) { cue.vx = Math.cos(a)*p; cue.vy = Math.sin(a)*p; playSound.billiardShot(p); }
    }
    setDragStart(null); setCurrentDrag(null); setPower(0);
  };

  if (gameState === 'SETUP') return (
    <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto p-4">
        <div className="bg-slate-900/60 backdrop-blur-xl p-8 rounded-2xl shadow-xl border border-white/5 w-full animate-zoom-in">
          <h2 className="text-3xl font-bold text-center mb-6 text-cyan-400">台球大师</h2>
          <div className="bg-black/20 p-4 rounded-xl mb-6 border border-white/5 space-y-4">
               <div><label className="block text-xs text-slate-500 mb-2">选择模式</label><div className="flex gap-4">
                   <button onClick={() => setMode('8BALL')} className={`flex-1 py-2 rounded-lg border transition-all ${mode === '8BALL' ? 'bg-cyan-600 border-cyan-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>🎱 中式八球</button>
                   <button onClick={() => setMode('9BALL')} className={`flex-1 py-2 rounded-lg border transition-all ${mode === '9BALL' ? 'bg-orange-600 border-orange-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>9️⃣ 九球</button>
               </div></div>
               <div><label className="block text-xs text-slate-500 mb-1">总局数</label><div className="flex gap-2">
                   {[1, 3, 5].map(num => <button key={num} onClick={() => setMatchConfig({...matchConfig, totalFrames: num})} className={`flex-1 py-1 rounded border ${matchConfig.totalFrames === num ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>BO{num}</button>)}
               </div></div>
               <div className="pt-2 border-t border-white/5"><div className="flex justify-between items-center text-xs"><span className="text-slate-400">对手</span><span className="text-white font-bold">{player2?.username || '测试路人'}</span></div></div>
          </div>
          <Button onClick={() => startMatch(mode)} className="w-full py-3 text-lg bg-cyan-600">开始比赛</Button>
        </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-2 overflow-hidden select-none">
       <div className="w-full max-w-2xl mb-2 flex justify-between items-end px-2">
          <div className="flex items-center gap-4">
             {[1, 2].map(p => (
                 <div key={p} className={`flex flex-col items-center ${turn === p ? 'scale-110 opacity-100' : 'opacity-60'}`}>
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/20 mb-1 overflow-hidden">{p === 1 ? (user.avatar?.startsWith('data:') ? <img src={user.avatar} className="w-full h-full object-cover"/> : user.avatar) : (player2?.avatar || '👤')}</div>
                    <div className="flex items-center gap-1"><span className="text-xs font-bold text-slate-300">P{p}</span><span className="text-lg font-black text-white">{p === 1 ? matchScore.p1 : matchScore.p2}</span></div>
                    {mode === '8BALL' && playerGroups[p as 1|2] && <span className={`text-[10px] px-1 rounded ${playerGroups[p as 1|2] === 'SOLIDS' ? 'bg-red-500 text-white' : 'bg-white text-black'}`}>{playerGroups[p as 1|2] === 'SOLIDS' ? '全色' : '花色'}</span>}
                 </div>
             ))}
          </div>
          <div className="flex flex-col items-end">
             {foulMessage && <div className="text-red-400 font-bold text-sm animate-bounce mb-1">{foulMessage}</div>}
             {placingBall && <div className="text-green-400 font-bold text-xs animate-pulse mb-1">自由球：点击放置母球</div>}
             <Button onClick={() => setGameState('SETUP')} variant="secondary" className="text-xs h-6">结束比赛</Button>
          </div>
       </div>
       <div ref={containerRef} className="relative w-full max-w-4xl aspect-[2/1] bg-slate-800 rounded-lg shadow-2xl border-8 border-yellow-900/40">
           <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair touch-none" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp} />
           {gameState === 'ROUND_OVER' && <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4"><h3 className="text-2xl font-bold text-white mb-2">本局结束</h3><p className="text-cyan-400 mb-6 text-lg">{winner} 获胜</p><Button onClick={initRound}>下一局</Button></div>}
           {gameState === 'GAMEOVER' && <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4"><div className="text-6xl mb-4">🏆</div><h3 className="text-4xl font-bold text-yellow-400 mb-2">比赛结束</h3><p className="text-white text-2xl font-bold mb-6">{matchWinner} 获得最终胜利</p><Button onClick={() => setGameState('SETUP')}>返回大厅</Button></div>}
       </div>
    </div>
  );
};