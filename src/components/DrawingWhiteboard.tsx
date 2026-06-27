import React, { useRef, useState, useEffect } from "react";
import { Socket } from "socket.io-client";
import { doc, setDoc, getDoc, collection, limit, orderBy, query, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { 
  Palette, 
  Trash2, 
  Sparkles, 
  Save, 
  Download, 
  Eraser, 
  CornerDownLeft, 
  Check 
} from "lucide-react";

interface DrawingWhiteboardProps {
  roomId: string;
  socket: Socket | null;
  userId: string;
}

export default function DrawingWhiteboard({ roomId, socket, userId }: DrawingWhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("#14b8a6"); // Default electric teal
  const [lineWidth, setLineWidth] = useState(4);
  const [isEraser, setIsEraser] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Available cyber palette
  const colors = [
    { name: "Teal", hash: "#14b8a6" },     // Electric Teal
    { name: "Green", hash: "#22c55e" },    // Matrix Green
    { name: "Orange", hash: "#f97316" },   // Hot Orange
    { name: "Purple", hash: "#a855f7" },   // Cyber Purple
    { name: "Pink", hash: "#ec4899" },     // Digital Pink
    { name: "White", hash: "#ffffff" }      // Pure White
  ];

  // Draw a standard line segment on a canvas 2D context
  const drawSegment = (
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    segmentColor: string,
    segmentWidth: number,
    eraserMode: boolean
  ) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = eraserMode ? "#0c0e12" : segmentColor; // Erase matches background state
    ctx.lineWidth = segmentWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  // Resize canvas to fit the bounding element
  const resizeCanvasToFit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    
    // Save current drawings in an offline image
    const tempImage = new Image();
    const tempUrl = canvas.toDataURL();
    tempImage.src = tempUrl;

    tempImage.onload = () => {
      canvas.width = rect.width;
      canvas.height = rect.height || 450;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Redraw existing scene
        ctx.fillStyle = "#0c0e12"; // Match slate background
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempImage, 0, 0);
      }
    };
  };

  // Initial setup, resizing and socket listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0c0e12"; // Slate background
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Set initial size
    setTimeout(resizeCanvasToFit, 100);

    // Watch resize events
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvasToFit();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Load recent snapshot from firebase
    const loadRecentSnapshot = async () => {
      try {
        const q = query(
          collection(db, `whiteboard_snapshots`),
          orderBy("created_at", "desc"),
          limit(1)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const docData = snapshot.docs[0].data();
          if (docData && docData.room_id === roomId && docData.data) {
            const img = new Image();
            img.src = docData.data;
            img.onload = () => {
              const canvasContext = canvas.getContext("2d");
              if (canvasContext) {
                canvasContext.drawImage(img, 0, 0);
              }
            };
          }
        }
      } catch (err) {
        console.error("No snapshots retrieved:", err);
      }
    };

    loadRecentSnapshot();

    // Socket broadcasts listener
    if (socket) {
      socket.on("whiteboard:stroke", (stroke: { 
        x0: number, y0: number, x1: number, y1: number, 
        color: string, width: number, isEraser: boolean 
      }) => {
        const drawContext = canvas.getContext("2d");
        if (drawContext) {
          drawSegment(
            drawContext,
            stroke.x0,
            stroke.y0,
            stroke.x1,
            stroke.y1,
            stroke.color,
            stroke.width,
            stroke.isEraser
          );
        }
      });

      socket.on("whiteboard:clear", () => {
        const drawContext = canvas.getContext("2d");
        if (drawContext) {
          drawContext.fillStyle = "#0c0e12";
          drawContext.fillRect(0, 0, canvas.width, canvas.height);
        }
      });
    }

    return () => {
      resizeObserver.disconnect();
      if (socket) {
        socket.off("whiteboard:stroke");
        socket.off("whiteboard:clear");
      }
    };
  }, [roomId, socket]);

  // Utility to find correct canvas mouse offset
  const getMouseCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getMouseCoords(e);
    setIsDrawing(true);
    setLastPos(coords);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const coords = getMouseCoords(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      drawSegment(
        ctx,
        lastPos.x,
        lastPos.y,
        coords.x,
        coords.y,
        color,
        lineWidth,
        isEraser
      );

      // Broadcast stroke via socket.io
      if (socket) {
        socket.emit("whiteboard:stroke", {
          roomId,
          stroke: {
            x0: lastPos.x,
            y0: lastPos.y,
            x1: coords.x,
            y1: coords.y,
            color,
            width: lineWidth,
            isEraser
          }
        });
      }

      setLastPos(coords);
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      // Auto save snapshot update on mouse up to keep firestore updated
      saveSnapshotSilent();
    }
  };

  // Triggers silent snapshot saved to database
  const saveSnapshotSilent = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const imgDataUrl = canvas.toDataURL("image/png");
      const docRef = doc(db, "whiteboard_snapshots", roomId);
      await setDoc(docRef, {
        room_id: roomId,
        data: imgDataUrl,
        created_at: Date.now()
      });
    } catch (e) {
      console.warn("Silent snapshot update deferred.", e);
    }
  };

  // Explicit save triggers success toast UI state
  const saveSnapshotExplicit = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSaving(true);
    setIsSaved(false);

    try {
      const imgDataUrl = canvas.toDataURL("image/png");
      // Use document path /whiteboard_snapshots/{roomId} so we always keep a single active snap per room!
      const docRef = doc(db, "whiteboard_snapshots", roomId);
      await setDoc(docRef, {
        room_id: roomId,
        data: imgDataUrl,
        created_at: Date.now()
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save snapshot to Firestore:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0c0e12";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Notify other room participants
      if (socket) {
        socket.emit("whiteboard:clear", { roomId });
      }

      saveSnapshotSilent();
    }
  };

  const downloadCanvasAsLocalPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `whiteboard_snapshot_${new Date().getTime()}.png`;
    link.href = url;
    link.click();
  };

  return (
    <div id="whiteboard-module" className="flex flex-col h-full bg-brand-panel border border-brand-border rounded-xl overflow-hidden shadow-inner">
      
      {/* Tool Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-panel border-b border-brand-border p-3">
        
        {/* Colors & Modes */}
        <div className="flex items-center gap-2">
          {colors.map((c) => (
            <button
              key={c.hash}
              id={`color-btn-${c.name}`}
              onClick={() => {
                setColor(c.hash);
                setIsEraser(false);
              }}
              style={{ backgroundColor: c.hash }}
              className={`w-6 h-6 rounded-full border-2 transition active:scale-95 cursor-pointer ${
                color === c.hash && !isEraser
                  ? "border-brand-accent scale-110 shadow-[0_0_10px_rgba(20,184,166,0.6)]"
                  : "border-brand-border hover:border-slate-400"
              }`}
              title={c.name}
            />
          ))}

          {/* Eraser */}
          <button
            id="eraser-tool-btn"
            onClick={() => setIsEraser(true)}
            className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center justify-center ${
              isEraser 
                ? "bg-brand-accent/10 border-brand-accent text-brand-accent shadow-[0_0_8px_rgba(20,184,166,0.2)]" 
                : "border-brand-border text-slate-400 hover:text-slate-200"
            }`}
            title="Toggle Rubber Eraser"
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        {/* Thickness Controls */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="font-mono">Sz:</span>
          <input
            id="line-width-slider"
            type="range"
            min={1}
            max={20}
            className="w-20 accent-brand-accent bg-brand-bg h-1.5 rounded-lg cursor-pointer"
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
          />
          <span className="font-mono w-4">{lineWidth}px</span>
        </div>

        {/* Operation buttons */}
        <div className="flex items-center gap-2">
          <button
            id="clear-whiteboard-btn"
            onClick={clearCanvas}
            className="p-1.5 bg-brand-bg border border-brand-border hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-lg text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
            title="Clean Slate"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            id="save-whiteboard-snapshot-btn"
            onClick={saveSnapshotExplicit}
            disabled={isSaving}
            className="p-1.5 bg-brand-bg border border-brand-border hover:border-brand-accent/30 text-slate-400 hover:text-brand-accent rounded-lg text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
            title="Commit snap to cloud"
          >
            {isSaved ? <Check className="w-3.5 h-3.5 text-brand-accent" /> : <Save className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">
              {isSaving ? "Saving..." : isSaved ? "Saved" : "Save Cloud"}
            </span>
          </button>

          <button
            id="download-whiteboard-snapshot-btn"
            onClick={downloadCanvasAsLocalPng}
            className="p-1.5 bg-brand-bg border border-brand-border hover:border-slate-300 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
            title="Download PNG File"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>

      </div>

      {/* Canvas container wrapper */}
      <div 
        ref={containerRef} 
        className="flex-grow w-full relative touch-none bg-brand-bg flex items-center justify-center cursor-crosshair min-h-[400px]"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          className="block max-w-full w-full h-full"
        />
        
        {/* Status Indicator overlay */}
        <div className="absolute bottom-2 left-2 z-10 pointer-events-none text-[8px] font-mono bg-[#0c0e12]/80 border border-brand-border px-2 py-0.5 rounded text-brand-accent select-none uppercase tracking-widest flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-ping inline-block" />
          {isEraser ? "ERASER ENGAGED" : `COLOR: ${color}`}
        </div>
      </div>

    </div>
  );
}
