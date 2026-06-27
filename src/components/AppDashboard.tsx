import React, { useState, useEffect } from "react";
import { collection, addDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { Room } from "../types";
import { 
  Plus, 
  ArrowRight, 
  LogOut, 
  Video, 
  Clock, 
  Lock, 
  Radio, 
  Layers, 
  User, 
  Zap 
} from "lucide-react";

interface AppDashboardProps {
  onJoinRoom: (roomId: string) => void;
  onLogout: () => void;
}

export default function AppDashboard({ onJoinRoom, onLogout }: AppDashboardProps) {
  const [roomName, setRoomName] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [recentRooms, setRecentRooms] = useState<Room[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const currentUser = auth.currentUser;

  // Load recent active rooms
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const q = query(
          collection(db, "rooms"),
          where("is_active", "==", true),
          orderBy("started_at", "desc"),
          limit(6)
        );
        const querySnapshot = await getDocs(q);
        const loaded: Room[] = [];
        querySnapshot.forEach((doc) => {
          loaded.push({ id: doc.id, ...doc.data() } as Room);
        });
        setRecentRooms(loaded);
      } catch (err) {
        console.error("Error fetching rooms or setting up composite index:", err);
        // Fallback: search without ordering if firestore composite index is compiling
        try {
          const qFallback = query(
            collection(db, "rooms"),
            where("is_active", "==", true),
            limit(10)
          );
          const snapFallback = await getDocs(qFallback);
          const loadedFallback: Room[] = [];
          snapFallback.forEach((doc) => {
            loadedFallback.push({ id: doc.id, ...doc.data() } as Room);
          });
          setRecentRooms(loadedFallback);
        } catch (e2) {
          console.error("Strict fallback query failed:", e2);
        }
      }
    };

    fetchRooms();
  }, []);

  const generateJoinCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed visual lookalikes (I, O, 0, 1)
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || !currentUser) return;

    setIsCreating(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const code = generateJoinCode();
      const roomData = {
        name: roomName.trim(),
        host_id: currentUser.uid,
        join_code: code,
        is_active: true,
        started_at: Date.now(),
        ended_at: null
      };

      const docRef = await addDoc(collection(db, "rooms"), roomData);
      
      // Also register host as a message system notification
      await addDoc(collection(db, "messages"), {
        room_id: docRef.id,
        user_id: "system",
        user_name: "SYSTEM",
        user_avatar: "",
        body: `${currentUser.displayName || "Host"} initialized the terminal session.`,
        kind: "system",
        created_at: Date.now()
      });

      setSuccessMsg(`Session generated successfully. Code: ${code}`);
      setRoomName("");
      onJoinRoom(docRef.id);
    } catch (err: any) {
      console.error("Failed to create room:", err);
      setErrorMsg("Failed to initialize session. Check Firestore permissions.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedCode = joinCodeInput.trim().toUpperCase();
    if (formattedCode.length !== 6) {
      setErrorMsg("Operational link codes must be exactly 6 characters.");
      return;
    }

    setIsJoining(true);
    setErrorMsg("");

    try {
      const q = query(
        collection(db, "rooms"),
        where("join_code", "==", formattedCode),
        where("is_active", "==", true),
        limit(1)
      );
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        throw new Error("No active control center found matching that link code.");
      }

      const roomDoc = querySnapshot.docs[0];
      onJoinRoom(roomDoc.id);
    } catch (err: any) {
      console.error("Error joining room:", err);
      setErrorMsg(err.message || "Failed to establish link. Terminal unresponsive.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-slate-200 font-sans selection:bg-brand-accent selection:text-slate-950 p-6 relative">
      
      {/* Background elegant subtle geometric structure */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(45,51,61,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(45,51,61,0.15)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-25" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-accent/5 rounded-full filter blur-[120px] pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10">
        
        {/* Top Operational Bar */}
        <header id="dashboard-header" className="flex flex-col sm:flex-row items-center justify-between border-b border-brand-border bg-brand-panel p-5 rounded-xl mb-8 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-bg border border-brand-accent flex items-center justify-center text-brand-accent shadow-[0_0_12px_rgba(20,184,166,0.2)]">
              <div className="w-3.5 h-3.5 rounded-full bg-brand-accent shadow-[0_0_8px_#14b8a6] animate-pulse"></div>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2 font-sans">
                Control Room <span className="text-[10px] bg-brand-accent/10 text-brand-accent border border-brand-accent/20 px-2 py-0.5 rounded uppercase tracking-widest font-mono">Terminal v1.0</span>
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                OPERATIVE: {currentUser?.displayName || "SECURE_AGENT"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="bg-brand-card border border-brand-border rounded-lg px-4 py-2 flex items-center gap-3">
              <img
                src={currentUser?.photoURL || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(currentUser?.displayName || "agent")}`}
                alt="Avatar"
                className="w-8 h-8 rounded bg-brand-bg border border-brand-border"
                referrerPolicy="no-referrer"
              />
              <div className="text-left hidden sm:block">
                <p className="text-xs font-semibold text-slate-200">{currentUser?.displayName}</p>
                <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">LEVEL 1 APPARATUS</p>
              </div>
            </div>

            <button
              id="logout-btn"
              onClick={onLogout}
              className="p-2.5 rounded-lg border border-brand-border text-slate-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition cursor-pointer"
              title="Terminate Session"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Error/Notice display */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-950/40 border border-red-500/30 text-red-400 text-xs rounded-xl font-mono">
            [MALFUNCTION] {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 bg-teal-950/40 border border-brand-accent/30 text-brand-accent text-xs rounded-xl font-mono animate-fade-in">
            [PROCESS OK] {successMsg}
          </div>
        )}

        {/* Core Control Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          
          {/* Card: Launch Room */}
          <div id="launch-panel" className="bg-brand-panel border border-brand-border rounded-xl p-6 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 p-3 text-slate-800">
              <Layers className="w-16 h-16 pointer-events-none opacity-10" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-brand-accent mb-3">
                <Video className="w-5 h-5 text-brand-accent" />
                <span className="text-xs font-mono uppercase tracking-widest font-bold">DEPLOY TRANSMISSION POINT</span>
              </div>
              <h2 className="text-xl font-bold mb-2">Create Security Room</h2>
              <p className="text-xs text-slate-400 mb-6">
                Host a private encrypted command hub. Instantly activate multi-user camera shares, drawing boards, and host recordings.
              </p>
              
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <input
                  type="text"
                  required
                  placeholder="Operational Room Name (e.g., Command Alpha)"
                  className="w-full bg-[#0c0e12] border border-brand-border rounded-lg py-3 px-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-accent text-sm font-sans"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
                <button
                  id="submit-create-room-btn"
                  type="submit"
                  disabled={isCreating}
                  className="w-full bg-brand-accent text-slate-950 hover:brightness-110 font-bold uppercase tracking-widest py-3 px-4 rounded-lg text-xs transition flex justify-center items-center gap-2 cursor-pointer"
                >
                  {isCreating ? (
                    <span className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-4 h-4" /> Deploy Control Room
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Card: Connect via Code */}
          <div id="join-panel" className="bg-brand-panel border border-brand-border rounded-xl p-6 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 p-3 text-slate-800">
              <Lock className="w-16 h-16 pointer-events-none opacity-10" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-brand-accent mb-3">
                <Zap className="w-5 h-5 text-brand-accent" />
                <span className="text-xs font-mono uppercase tracking-widest font-bold">ESTABLISH VECTOR COUPLING</span>
              </div>
              <h2 className="text-xl font-bold mb-2">Link Secure Room Code</h2>
              <p className="text-xs text-slate-400 mb-6">
                Connect directly into an existing command stream by specifying its 6-character, alphanumeric coordinate code.
              </p>

              <form onSubmit={handleJoinByCode} className="space-y-4">
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="Enter 6-char room passcode (e.g. TR49AX)"
                  className="w-full bg-[#0c0e12] border border-brand-border rounded-lg py-3 px-4 text-slate-100 text-center font-mono placeholder:text-slate-600 focus:outline-none focus:border-brand-accent text-sm uppercase tracking-widest"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                />
                <button
                  id="submit-join-room-btn"
                  type="submit"
                  disabled={isJoining}
                  className="w-full bg-slate-200 text-slate-950 hover:bg-white font-bold uppercase tracking-widest py-3 px-4 rounded-lg text-xs transition flex justify-center items-center gap-2 cursor-pointer"
                >
                  {isJoining ? (
                    <span className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      Establish Link <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

        </div>

        {/* Operational list of active rooms */}
        <section id="recent-rooms-section">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-widest mb-4">
            <Clock className="w-4 h-4 text-brand-accent" />
            Active Command Channels
          </div>

          {recentRooms.length === 0 ? (
            <div className="bg-brand-panel border border-brand-border rounded-xl p-8 text-center text-slate-500 font-mono text-xs">
              No active command channels found globally. Create one above to initialize.
            </div>
          ) : (
            <div id="rooms-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentRooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-brand-panel border border-brand-border hover:border-brand-accent rounded-xl p-4 flex flex-col justify-between transition-all duration-205 group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-sm text-slate-200 group-hover:text-brand-accent line-clamp-1 transition">
                        {room.name}
                      </h3>
                      <span className="text-[10px] bg-brand-bg border border-brand-border rounded font-mono px-2 py-0.5 tracking-wider font-semibold text-brand-accent uppercase">
                        {room.join_code}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-500">
                      DEP_ID: {room.id.slice(0, 10).toUpperCase()}...
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#2d333d]">
                    <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-brand-accent shadow-[0_0_8px_#14b8a6] animate-pulse inline-block" />
                      LIVE FEED
                    </span>
                    <button
                      id={`join-recent-btn-${room.id}`}
                      onClick={() => onJoinRoom(room.id)}
                      className="text-xs font-semibold text-slate-300 hover:text-brand-accent flex items-center gap-1 font-mono transition cursor-pointer"
                    >
                      Coupling <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
