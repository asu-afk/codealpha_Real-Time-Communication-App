import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "./lib/firebase";
import AuthScreen from "./components/AuthScreen";
import AppDashboard from "./components/AppDashboard";
import MeetingRoom from "./components/MeetingRoom";
import { Loader2 } from "lucide-react";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [kickedMsg, setKickedMsg] = useState<string | null>(null);

  // Parse path coordinates to support shared bookmark links (e.g. /room/SOME_ROOM_ID)
  useEffect(() => {
    const parsePath = () => {
      const path = window.location.pathname;
      const roomMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
      if (roomMatch && roomMatch[1]) {
        setActiveRoomId(roomMatch[1]);
      } else {
        setActiveRoomId(null);
      }
    };

    parsePath();
    window.addEventListener("popstate", parsePath);
    return () => window.removeEventListener("popstate", parsePath);
  }, []);

  // Listen for Firebase authorization state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleJoinRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    window.history.pushState(null, "", `/room/${roomId}`);
  };

  const handleLeaveRoom = (msg?: string) => {
    if (msg) {
      setKickedMsg(msg);
      // clear kicked message after 8 seconds
      setTimeout(() => setKickedMsg(null), 8000);
    }
    setActiveRoomId(null);
    window.history.pushState(null, "", "/");
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveRoomId(null);
      window.history.pushState(null, "", "/");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  if (loading) {
    return (
      <div id="loader-fallback" className="min-h-screen bg-slate-950 flex flex-col justify-center items-center gap-3 text-teal-400 font-mono">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="text-xs uppercase tracking-widest text-slate-500">Syncing Uplink...</span>
      </div>
    );
  }

  // Not Logged In
  if (!user) {
    return <AuthScreen onAuthSuccess={() => setKickedMsg(null)} />;
  }

  // Kicked message notice overlay inside the main screens
  const kickedBanner = kickedMsg && (
    <div className="bg-red-950/80 border border-red-900 border-t-0 p-3 text-red-400 text-xs text-center font-mono tracking-wide w-full fixed top-0 left-0 right-0 z-[100] animate-bounce">
      ⚠️ [SECURITY ALERT] {kickedMsg}
    </div>
  );

  // Render Rooms
  if (activeRoomId) {
    return (
      <>
        {kickedBanner}
        <MeetingRoom roomId={activeRoomId} onLeave={handleLeaveRoom} />
      </>
    );
  }

  // Render main Terminal Dashboard
  return (
    <>
      {kickedBanner}
      <AppDashboard onJoinRoom={handleJoinRoom} onLogout={handleLogout} />
    </>
  );
}
