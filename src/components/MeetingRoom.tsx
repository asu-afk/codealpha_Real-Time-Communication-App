import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  updateDoc, 
  doc, 
  getDoc 
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "../lib/firebase";
import { Message, Recording, Room, RoomParticipant } from "../types";
import DrawingWhiteboard from "./DrawingWhiteboard";
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  Monitor, 
  Radio, 
  MessageSquare, 
  Users, 
  PenTool, 
  FolderClosed, 
  CircleDot, 
  Play, 
  Square, 
  LogOut, 
  Paperclip, 
  Send, 
  Download, 
  UserX, 
  Activity, 
  Tv, 
  VolumeX, 
  Volume2 
} from "lucide-react";

interface MeetingRoomProps {
  roomId: string;
  onLeave: (kickedMsg?: string) => void;
}

interface PeerStream {
  socketId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  stream: MediaStream;
}

export default function MeetingRoom({ roomId, onLeave }: MeetingRoomProps) {
  // Tabs for the collapsible deck
  const [activeTab, setActiveTab] = useState<"chat" | "files" | "whiteboard" | "recordings" | "people">("chat");
  const [roomInfo, setRoomInfo] = useState<Room | null>(null);
  
  // Media States
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  // WebRTC Mesh Peers
  const socketRef = useRef<Socket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map()); // socketId -> RTCPeerConnection
  const [peers, setPeers] = useState<PeerStream[]>([]);
  const [socketParticipants, setSocketParticipants] = useState<any[]>([]);
  
  // Active Speaker volume tracks
  const [localVolume, setLocalVolume] = useState<number>(0);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({}); // socketId -> volume average

  // Firestore Sync States
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState("");
  const [recordings, setRecordings] = useState<Recording[]>([]);
  
  // Upload and Recording States
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<any>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const currentUser = auth.currentUser;
  const isHost = roomInfo?.host_id === currentUser?.uid;

  // 1. Fetch Room metadata upon mounting
  useEffect(() => {
    const fetchRoom = async () => {
      const docSnap = await getDoc(doc(db, "rooms", roomId));
      if (docSnap.exists()) {
        const data = docSnap.data() as Room;
        if (!data.is_active) {
          onLeave("This tactical commission has already been decommissioned.");
          return;
        }
        setRoomInfo({ id: docSnap.id, ...data });
      } else {
        onLeave("The requested operational target was not found.");
      }
    };
    fetchRoom();
  }, [roomId]);

  // 2. Local Media stream & WebSocket Socket.io signaling connection
  useEffect(() => {
    if (!currentUser) return;

    let localMediaStream: MediaStream | null = null;
    const socketUrl = window.location.origin; // Same host since full-stack

    const initConnection = async () => {
      try {
        // Grab audio/video stream from camera/microphone
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, frameRate: 15 },
          audio: true
        });
        setLocalStream(localMediaStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localMediaStream;
        }

        // Initialize Sockets
        const socket = io(socketUrl, {
          transports: ["websocket"]
        });
        socketRef.current = socket;

        // Subscribe to socket callbacks
        socket.on("connect", () => {
          socket.emit("join", {
            roomId,
            userId: currentUser.uid,
            name: currentUser.displayName || "Secure Agent",
            avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(currentUser.displayName || "agent")}`
          });
        });

        // Triggered when client gets list of other participants currently active in standard room
        socket.on("room-users", (otherUsers: any[]) => {
          otherUsers.forEach((user) => {
            const pc = createPeerConnection(user.socketId, user.userId, user.name, user.avatar, localMediaStream!);
            pcsRef.current.set(user.socketId, pc);
            
            // Create offer
            pc.createOffer()
              .then((offer) => pc.setLocalDescription(offer))
              .then(() => {
                socket.emit("offer", {
                  toSocketId: user.socketId,
                  offerSignal: pc.localDescription
                });
              })
              .catch((err) => console.error("Offer creation error:", err));
          });
        });

        // Other user joined -> Prepare remote subscriber
        socket.on("user-joined", (data: any) => {
          // We wait to receive the offer from the new joiner
        });

        // Receive Offer
        socket.on("offer", async (data: { fromSocketId: string; offerSignal: any }) => {
          const pc = createPeerConnection(data.fromSocketId, "remote-uid", "Remote Client", "", localMediaStream!);
          pcsRef.current.set(data.fromSocketId, pc);

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offerSignal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit("answer", {
              toSocketId: data.fromSocketId,
              answerSignal: pc.localDescription
            });
          } catch (e) {
            console.error("Answer negotiation failed:", e);
          }
        });

        // Receive Answer
        socket.on("answer", async (data: { fromSocketId: string; answerSignal: any }) => {
          const pc = pcsRef.current.get(data.fromSocketId);
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answerSignal));
            } catch (err) {
              console.error("Setting manual answer SDP failed:", err);
            }
          }
        });

        // Receive ICE candidate
        socket.on("ice-candidate", async (data: { fromSocketId: string; candidate: any }) => {
          const pc = pcsRef.current.get(data.fromSocketId);
          if (pc && data.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              console.error("Adding ICE candidate failed:", err);
            }
          }
        });

        // Participant Updates
        socket.on("participant-update", (list: any[]) => {
          setSocketParticipants(list);
        });

        socket.on("user-left", ({ socketId }: { socketId: string }) => {
          cleanupPeer(socketId);
        });

        // Handle Kicked command
        socket.on("kicked", (msg: { message: string }) => {
          cleanupAll();
          onLeave(msg.message);
        });

      } catch (err: any) {
        console.error("Media permission or network rejection:", err);
        setError("Could not access Web camera or microphone. Please enable permissions.");
      }
    };

    initConnection();

    return () => {
      cleanupAll();
    };
  }, [roomId, currentUser]);

  // Sinks for cleanups
  const cleanupPeer = (socketId: string) => {
    const pc = pcsRef.current.get(socketId);
    if (pc) {
      pc.close();
      pcsRef.current.delete(socketId);
    }
    setPeers((prev) => prev.filter((p) => p.socketId !== socketId));
    setRemoteVolumes((prev) => {
      const copy = { ...prev };
      delete copy[socketId];
      return copy;
    });
  };

  const cleanupAll = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
    }
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
    }
  };

  // Helper inside WebRTC mesh: Construct a single p2p link
  const createPeerConnection = (
    peerSocketId: string,
    peerUserId: string,
    pName: string,
    pAvatar: string,
    lStream: MediaStream
  ): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    // Relay candidate
    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit("ice-candidate", {
          toSocketId: peerSocketId,
          candidate: e.candidate
        });
      }
    };

    // Receive Remote Track
    pc.ontrack = (e) => {
      const rStream = e.streams[0] || new MediaStream([e.track]);
      
      // Update peer tracking
      setPeers((prev) => {
        const exists = prev.find((p) => p.socketId === peerSocketId);
        if (exists) {
          return prev.map((p) => (p.socketId === peerSocketId ? { ...p, stream: rStream } : p));
        }
        
        // Lookup other details from active socketParticipants
        const participantInfo = socketParticipants.find((sp) => sp.socketId === peerSocketId);

        return [
          ...prev,
          {
            socketId: peerSocketId,
            userId: peerUserId,
            userName: participantInfo?.name || pName || "Secure Peer",
            userAvatar: participantInfo?.avatar || pAvatar || "https://api.dicebear.com/7.x/identicon/svg?seed=agent",
            stream: rStream
          }
        ];
      });
    };

    // Push local tracks to peer
    lStream.getTracks().forEach((track) => {
      pc.addTrack(track, lStream);
    });

    return pc;
  };

  // 3. Audio Volume level measurement (Active speak detection)
  useEffect(() => {
    if (!localStream) return;
    try {
      const tracks = localStream.getAudioTracks();
      if (tracks.length === 0) return;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(localStream);
      source.connect(analyser);

      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        // Mute overrides sound
        setLocalVolume(isMuted ? 0 : avg);
      }, 200);

      return () => {
        clearInterval(interval);
        audioContext.close();
      };
    } catch (e) {
      console.warn("Speech detector suspended:", e);
    }
  }, [localStream, isMuted]);

  // Hook remote streams volume measurements
  useEffect(() => {
    const cancelers: Array<() => void> = [];

    peers.forEach((peer) => {
      try {
        const audioTracks = peer.stream.getAudioTracks();
        if (audioTracks.length === 0) return;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioCtx();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(peer.stream);
        source.connect(analyser);

        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const interval = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const avg = sum / bufferLength;
          setRemoteVolumes((prev) => ({
            ...prev,
            [peer.socketId]: avg
          }));
        }, 250);

        cancelers.push(() => {
          clearInterval(interval);
          audioContext.close();
        });
      } catch (err) {
        // Silent fallbacks for remote volume sampling
      }
    });

    return () => {
      cancelers.forEach((fn) => fn());
    };
  }, [peers]);

  // 4. Firestore Chat Message Subscription
  useEffect(() => {
    const q = query(
      collection(db, "messages"),
      where("room_id", "==", roomId),
      orderBy("created_at", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: Message[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as Message);
      });
      setMessages(items);
      // Auto scroll chat
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    });

    return unsubscribe;
  }, [roomId]);

  // Firestore Recordings subscription
  useEffect(() => {
    const q = query(
      collection(db, "recordings"),
      where("room_id", "==", roomId),
      orderBy("created_at", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const r: Recording[] = [];
      snapshot.forEach((doc) => {
        r.push({ id: doc.id, ...doc.data() } as Recording);
      });
      setRecordings(r);
    });
    return unsubscribe;
  }, [roomId]);

  const [errorText, setError] = useState<string | null>(null);
  const [showEndSessionConfirm, setShowEndSessionConfirm] = useState(false);
  const [showKickConfirm, setShowKickConfirm] = useState<{ targetSocketId: string; name: string } | null>(null);

  // Toggle local Audio (mute/unmute)
  const toggleAudio = () => {
    if (localStream) {
      const state = !isMuted;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !state;
      });
      setIsMuted(state);
      if (socketRef.current) {
        socketRef.current.emit("state-toggle", { micOn: !state });
      }
    }
  };

  // Toggle local Camera (on/off)
  const toggleVideo = () => {
    if (localStream) {
      const state = !isCamOff;
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !state;
      });
      setIsCamOff(state);
      if (socketRef.current) {
        socketRef.current.emit("state-toggle", { cameraOn: !state });
      }
    }
  };

  // Toggle Local Screen Sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Clean screen streams
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
      }
      setIsScreenSharing(false);
      
      // Put back original camera track on peers
      if (localStream) {
        const camTrack = localStream.getVideoTracks()[0];
        pcsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
          if (sender && camTrack) {
            sender.replaceTrack(camTrack);
          }
        });
      }

      if (socketRef.current) {
        socketRef.current.emit("state-toggle", { screenShareOn: false });
      }
    } else {
      try {
        const dispStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        setScreenStream(dispStream);
        setIsScreenSharing(true);

        const screenTrack = dispStream.getVideoTracks()[0];

        // Replace track on all outgoing RTC Peer relationships
        pcsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
          if (sender && screenTrack) {
            sender.replaceTrack(screenTrack);
          }
        });

        // Watch exit from standard browser share stopping button
        screenTrack.onended = () => {
          toggleScreenShare(); // recursive end fallback
        };

        if (socketRef.current) {
          socketRef.current.emit("state-toggle", { screenShareOn: true });
        }
      } catch (err) {
        console.warn("Screen share cancel/denied:", err);
      }
    }
  };

  // Chat message submit
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !currentUser) return;

    try {
      await addDoc(collection(db, "messages"), {
        room_id: roomId,
        user_id: currentUser.uid,
        user_name: currentUser.displayName || "Agent",
        user_avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(currentUser.displayName || "agent")}`,
        body: textInput.trim(),
        kind: "text",
        created_at: Date.now()
      });
      setTextInput("");
    } catch (e) {
      console.error("Message writing error:", e);
    }
  };

  // Secure File attachment upload to Firebase Storage
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    // Check size limit: Let's reject files exceeding 25MB
    if (file.size > 25 * 1024 * 1024) {
      setError("Terminal protocol limitation: Files cannot exceed 25MB.");
      return;
    }

    setUploadProgress(1);

    const storagePath = `room-files/${roomId}/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(fileRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setUploadProgress(percent);
      },
      (error) => {
        console.error("Storage upload failed:", error);
        setError("Upload error. Inspect storage rules and configuration.");
        setUploadProgress(null);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        
        // Write the special type: file message to Firestore
        await addDoc(collection(db, "messages"), {
          room_id: roomId,
          user_id: currentUser.uid,
          user_name: currentUser.displayName || "Agent",
          user_avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(currentUser.displayName || "agent")}`,
          body: `Transmission Shared: ${file.name}`,
          kind: "file",
          file_path: storagePath,
          file_url: downloadUrl,
          file_name: file.name,
          created_at: Date.now()
        });

        setUploadProgress(null);
      }
    );
  };

  // Tactical Host-side Video/Audio Recording
  const startRecordingSession = async () => {
    if (!isHost) return;

    try {
      // Capture the user screen layout to record full conference experience
      const captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true
      });
      
      recordingChunksRef.current = [];
      const options = { mimeType: "video/webm;codecs=vp8" };
      
      const recorder = new MediaRecorder(captureStream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        captureStream.getTracks().forEach((track) => track.stop());

        if (recordingChunksRef.current.length === 0) return;

        const blob = new Blob(recordingChunksRef.current, { type: "video/webm" });
        const storagePath = `recordings/${roomId}/${new Date().getTime()}_session.webm`;
        const fileRef = ref(storage, storagePath);

        // Upload recorded tactical stream directly to storage
        const uploadTask = uploadBytesResumable(fileRef, blob);
        uploadTask.on(
          "state_changed",
          null,
          (err) => console.error("Recording upload error:", err),
          async () => {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            
            // Add reference schema to recordings
            await addDoc(collection(db, "recordings"), {
              room_id: roomId,
              storage_path: storagePath,
              url: downloadUrl,
              duration_s: recordingDuration || 1,
              created_at: Date.now()
            });

            // Write system report chat
            await addDoc(collection(db, "messages"), {
              room_id: roomId,
              user_id: "system",
              user_name: "SYSTEM REPORT",
              user_avatar: "",
              body: `Interactive session recording saved to Operations logs. Duration: ${recordingDuration}s.`,
              kind: "system",
              created_at: Date.now()
            });
          }
        );
      };

      recorder.start(1000); // chunk intervals of 1s
      setIsRecording(true);
      setRecordingDuration(0);

      durationTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.warn("Screen recording access denied or cancelled:", err);
    }
  };

  const stopRecordingSession = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    }
  };

  // End entire session (Host Only: Close room down in Firestore)
  const executeEndSession = async () => {
    if (!isHost || !roomInfo) return;
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        is_active: false,
        ended_at: Date.now()
      });

      // Delete active rooms memory or socket triggers
      onLeave("The room has been fully decommissioned by the host.");
    } catch (err) {
      console.error("Dismantling room failed:", err);
    }
  };

  const handleEndSession = () => {
    setShowEndSessionConfirm(true);
  };

  // Kick participant trigger (Host only)
  const executeKickParticipant = (targetSocketId: string) => {
    if (!isHost) return;
    if (socketRef.current) {
      socketRef.current.emit("kick-operative", { toSocketId: targetSocketId });
    }
    setShowKickConfirm(null);
  };

  const handleKickParticipant = (targetSocketId: string, name: string) => {
    if (!isHost) return;
    setShowKickConfirm({ targetSocketId, name });
  };

  // Separate file message filtering to dynamically populate Files Tab
  const sharedFiles = messages.filter((m) => m.kind === "file");

  // Multi-grid CSS fitting
  const getGridClasses = () => {
    const counts = peers.length + 1; // plus self
    if (counts === 1) return "grid-cols-1";
    if (counts === 2) return "grid-cols-1 md:grid-cols-2";
    if (counts <= 4) return "grid-cols-2";
    return "grid-cols-2 lg:grid-cols-3";
  };

  return (
    <div id="conference-operations" className="min-h-screen bg-brand-bg font-sans text-slate-200 flex flex-col justify-between selection:bg-brand-accent selection:text-slate-950">
      
      {/* Top operational header bar */}
      <header className="h-16 bg-brand-panel border-b border-brand-border px-6 flex items-center justify-between gap-4 shrink-0">
        
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-brand-accent shadow-[0_0_8px_#14b8a6]"></div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              {roomInfo?.name || "SECURE_FREQUENCY"}
            </h1>
            <p className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 uppercase font-semibold">
              ROOM_ID: <span className="text-white font-mono tracking-wider">{roomInfo?.join_code}</span>
              <span className="hidden sm:inline text-brand-border">|</span> 
              <span className="hidden sm:inline bg-brand-accent/10 border border-brand-accent/20 px-1 rounded text-[9px] text-brand-accent">ENCRYPTED MESH P2P</span>
            </p>
          </div>
        </div>

        {/* Live System indicators & Host Panel */}
        <div className="flex items-center gap-8 text-xs font-mono">
          
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-brand-accent font-bold">Live Session</div>
            <div className="font-mono text-sm text-white">
              {isRecording ? `REC ${Math.floor(recordingDuration / 60).toString().padStart(2, "0")}:${(recordingDuration % 60).toString().padStart(2, "0")}` : "ACTIVE"}
            </div>
          </div>

          <div className="h-8 w-[1px] bg-brand-border hidden md:block"></div>

          <div className="hidden md:flex items-center gap-2 bg-brand-card border border-brand-border rounded-lg px-2.5 py-1 text-slate-400 text-[10px]">
            <Activity className="w-3.5 h-3.5 text-brand-accent" />
            PARTICIPANTS: {socketParticipants.length}
          </div>

          <div className="flex items-center gap-3">
            {isHost && (
              <button
                id="end-session-host-btn"
                onClick={handleEndSession}
                className="bg-red-900/20 border border-red-500 text-red-500 px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-500 hover:text-white transition cursor-pointer"
              >
                End Call
              </button>
            )}

            <button
              id="leave-session-btn"
              onClick={() => onLeave()}
              className="bg-[#1e222a] hover:bg-slate-800 border border-brand-border text-slate-300 px-4 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-widest font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-brand-accent" />
              Leave Case
            </button>
          </div>

        </div>

      </header>

      {/* Main operational panels layout (Grid Video + Right Sidebar collapsible desk) */}
      <main className="flex-grow flex flex-col md:flex-row overflow-hidden relative" ref={containerRef}>
        
        {/* Error notification banner */}
        {errorText && (
          <div className="absolute top-4 left-4 right-4 z-50 p-3 bg-red-950/90 border border-red-800 text-red-400 text-xs font-mono rounded-lg flex items-center justify-between shadow-lg">
            <span>[MALFUNCTION] {errorText}</span>
            <button 
              onClick={() => setError(null)} 
              className="text-red-400 hover:text-red-200 ml-4 font-bold text-sm cursor-pointer px-1.5 py-0.5 rounded hover:bg-red-905/35 transition"
              title="Acknowledge and dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        {/* Left Side: Dynamic peer Grid layout */}
        <div className="flex-grow p-4 overflow-y-auto flex items-center justify-center bg-brand-bg">
          
          <div className={`grid gap-4 w-full h-full max-h-[85vh] ${getGridClasses()}`}>
            
            {/* 1. LOCAL SELF FEED TILE */}
            <div 
              id="self-video-tile" 
              className={`bg-brand-card border rounded-xl overflow-hidden relative aspect-video flex flex-col justify-center items-center group transition duration-300 ${
                localVolume > 15 
                  ? "border-brand-accent shadow-[0_0_20px_rgba(20,184,166,0.15)] scale-[1.01]" 
                  : "border-brand-border hover:border-slate-700"
              }`}
            >
              <video
                ref={(el) => {
                  if (el) {
                    localVideoRef.current = el;
                    if (localStream && el.srcObject !== localStream) {
                      el.srcObject = localStream;
                    }
                  }
                }}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transform scale-x-[-1] ${isCamOff ? "hidden" : ""}`}
              />

              {isCamOff && (
                <div className="text-center absolute inset-0 flex flex-col justify-center items-center bg-brand-bg z-10">
                  <div className="w-16 h-16 rounded-full bg-brand-card border border-brand-border flex items-center justify-center mx-auto mb-2 text-slate-500">
                    <VideoOff className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-xs font-mono text-slate-500">FEED SHUTDOWN (CAMERA OFF)</p>
                </div>
              )}

              {/* Speaker volume analyzer graphical overlay */}
              {localVolume > 5 && !isMuted && (
                <div className="absolute top-3 left-3 bg-brand-accent text-black px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1">
                  <span>●</span> YOU (SPEAKING)
                </div>
              )}

              {/* Control Badges bottom */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none select-none z-10">
                <span className="text-xs font-semibold bg-black/60 backdrop-blur text-white px-2 py-0.5 rounded text-[10px] flex items-center gap-1.5">
                  {currentUser?.displayName || "You"} (Host/Me)
                </span>

                <div className="flex gap-1.5">
                  {isMuted && (
                    <span className="p-1 px-1.5 bg-red-950/85 border border-red-900 rounded-lg text-red-500 text-[9px] font-mono leading-none">
                      MUTED
                    </span>
                  )}
                  {isScreenSharing && (
                    <span className="p-1 px-1.5 bg-brand-accent/85 border border-brand-accent rounded text-black text-[9px] font-mono leading-none flex items-center gap-1">
                      <Tv className="w-2.5 h-2.5" /> SCREEN
                    </span>
                  )}
                </div>
              </div>

            </div>

            {/* 2. REMOTE PEERS TILES */}
            {peers.map((peer) => {
              const isSpeaking = (remoteVolumes[peer.socketId] || 0) > 15;
              const remoteSocketMeta = socketParticipants.find((sp) => sp.socketId === peer.socketId);
              const isPeerMuted = remoteSocketMeta ? !remoteSocketMeta.micOn : false;
              const isPeerCamOff = remoteSocketMeta ? !remoteSocketMeta.cameraOn : false;

              return (
                <div
                  key={peer.socketId}
                  id={`peer-tile-${peer.socketId}`}
                  className={`bg-brand-card border rounded-xl overflow-hidden relative aspect-video flex flex-col justify-center items-center group transition duration-300 ${
                    isSpeaking
                      ? "border-brand-accent shadow-[0_0_20px_rgba(20,184,166,0.15)] scale-[1.01]"
                      : "border-brand-border hover:border-slate-700"
                  }`}
                >
                  <video
                    ref={(el) => {
                      if (el && el.srcObject !== peer.stream) {
                        el.srcObject = peer.stream;
                      }
                    }}
                    autoPlay
                    playsInline
                    className={`w-full h-full object-cover ${isPeerCamOff ? "hidden" : ""}`}
                  />

                  {isPeerCamOff && (
                    <div className="text-center absolute inset-0 flex flex-col justify-center items-center bg-brand-bg z-10">
                      <div className="w-14 h-14 rounded-full bg-brand-card border border-brand-border flex items-center justify-center mx-auto mb-2 text-slate-600">
                        <VideoOff className="w-5 h-5 text-slate-400" />
                      </div>
                      <p className="text-xs font-mono text-slate-500">{peer.userName} (FEED OFF)</p>
                    </div>
                  )}

                  {/* Speaker indicator overlay */}
                  {isSpeaking && (
                    <div className="absolute top-3 left-3 bg-brand-accent text-black px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1">
                      <span>●</span> {peer.userName} (SPEAKING)
                    </div>
                  )}

                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none select-none z-10">
                    <span className="text-xs font-semibold bg-black/60 backdrop-blur text-white px-2 py-0.5 rounded text-[10px] flex items-center gap-2">
                      <img
                        src={peer.userAvatar}
                        alt="Avatar"
                        className="w-4 h-4 rounded bg-[#0c0e12]"
                        referrerPolicy="no-referrer"
                      />
                      {peer.userName}
                    </span>

                    <div className="flex gap-1">
                      {isPeerMuted && (
                        <span className="p-1 px-1.5 bg-red-950/85 border border-red-900 rounded-lg text-red-500 text-[9px] font-mono leading-none">
                          MUTED
                        </span>
                      )}
                    </div>
                  </div>

                </div>
              );
            })}

          </div>

        </div>

        {/* Right Side: Tabbed deck menu control center */}
        <aside className="w-full md:w-[380px] bg-brand-panel border-t md:border-t-0 md:border-l border-brand-border flex flex-col justify-between overflow-hidden shrink-0">
          
          {/* Deck tabs */}
          <div className="flex bg-brand-panel border-b border-brand-border text-slate-400 text-xs font-mono h-11 shrink-0 overflow-x-auto">
            
            <button
              id="tab-chat-btn"
              onClick={() => setActiveTab("chat")}
              className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 border-b-2 hover:text-slate-100 transition cursor-pointer ${
                activeTab === "chat" ? "border-brand-accent text-brand-accent bg-brand-bg/40 font-bold" : "border-transparent bg-transparent"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>

            <button
              id="tab-files-btn"
              onClick={() => setActiveTab("files")}
              className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 border-b-2 hover:text-slate-100 transition cursor-pointer ${
                activeTab === "files" ? "border-brand-accent text-brand-accent bg-brand-bg/40 font-bold" : "border-transparent bg-transparent"
              }`}
            >
              <FolderClosed className="w-3.5 h-3.5" />
              <span>Files</span>
            </button>

            <button
              id="tab-whiteboard-btn"
              onClick={() => setActiveTab("whiteboard")}
              className={`flex-1 min-w-[85px] flex items-center justify-center gap-1 border-b-2 hover:text-slate-100 transition cursor-pointer ${
                activeTab === "whiteboard" ? "border-brand-accent text-brand-accent bg-brand-bg/40 font-bold" : "border-transparent bg-transparent"
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>

            <button
              id="tab-recordings-btn"
              onClick={() => setActiveTab("recordings")}
              className={`flex-1 min-w-[85px] flex items-center justify-center gap-1 border-b-2 hover:text-slate-100 transition cursor-pointer ${
                activeTab === "recordings" ? "border-brand-accent text-brand-accent bg-brand-bg/40 font-bold" : "border-transparent bg-transparent"
              }`}
            >
              <CircleDot className="w-3.5 h-3.5 text-red-500" />
              <span>Recs</span>
            </button>

            <button
              id="tab-people-btn"
              onClick={() => setActiveTab("people")}
              className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 border-b-2 hover:text-slate-100 transition cursor-pointer ${
                activeTab === "people" ? "border-brand-accent text-brand-accent bg-brand-bg/40 font-bold" : "border-transparent bg-transparent"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>People</span>
            </button>

          </div>

          {/* Tab content area */}
          <div className="flex-grow overflow-y-auto p-4 flex flex-col justify-between h-[350px] md:h-[60vh] bg-brand-panel">
            
            {/* TAB: CHAT */}
            {activeTab === "chat" && (
              <div className="flex flex-col h-full justify-between gap-4">
                
                {/* Message logs */}
                <div className="flex-grow overflow-y-auto space-y-3 pr-1 text-xs">
                  {messages.length === 0 ? (
                    <div className="text-slate-500 font-mono text-center pt-8">
                      Secure session messages. Encrypted end-to-end.
                    </div>
                  ) : (
                    messages.map((m) => {
                      if (m.kind === "system") {
                        return (
                           <div key={m.id} className="p-2 bg-brand-bg/60 border border-brand-border rounded-lg text-[10px] font-mono text-slate-400 text-center uppercase tracking-wider">
                            {m.body}
                          </div>
                        );
                      }

                      const isMyMessage = m.user_id === currentUser?.uid;

                      return (
                        <div
                          key={m.id}
                          className={`flex items-start gap-2.5 ${isMyMessage ? "flex-row-reverse" : ""}`}
                        >
                          <img
                            src={m.user_avatar}
                            alt="Avatar"
                            className="w-7 h-7 rounded bg-brand-bg border border-brand-border cursor-help"
                            title={m.user_name}
                            referrerPolicy="no-referrer"
                          />
                          <div className={`max-w-[80%] ${isMyMessage ? "text-right" : ""}`}>
                            <div className="flex items-center gap-1.5 mb-1 justify-content">
                              <span className="font-semibold text-[10px] text-slate-400">{m.user_name}</span>
                              <span className="text-[8px] text-slate-500 font-mono">
                                {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>

                            {/* Message Container content */}
                            {m.kind === "file" ? (
                              <div className="inline-block p-2.5 bg-brand-card border border-brand-border text-slate-200 text-left rounded-xl">
                                <p className="font-mono text-[10px] text-brand-accent flex items-center gap-1 mb-1 truncate max-w-[200px]">
                                  <FolderClosed className="w-3.5 h-3.5" /> Shared File
                                </p>
                                <p className="text-xs mb-1.5 font-sans break-all">{m.file_name || "Attachment"}</p>
                                <a
                                  href={m.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 bg-brand-accent text-slate-950 px-2 py-1 rounded text-[9px] font-mono font-bold hover:brightness-110 antialiased"
                                >
                                  <Download className="w-3 h-3" /> Fetch Download
                                </a>
                              </div>
                            ) : (
                              <div className={`inline-block p-2.5 rounded-xl text-left leading-relaxed ${
                                isMyMessage 
                                  ? "bg-brand-accent text-slate-950 font-bold" 
                                  : "bg-brand-message border border-brand-border text-slate-200"
                              }`}>
                                {m.body}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Secure File upload progress indicator bar */}
                {uploadProgress !== null && (
                  <div className="bg-brand-bg border border-brand-border p-2 rounded-lg font-mono text-[9px]">
                    <div className="flex justify-between text-brand-accent mb-1">
                      <span>UPLOADING RAW DISK PACKET...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-brand-card rounded-full h-1 overflow-hidden">
                      <div className="bg-brand-accent h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}

                {/* Input panel block */}
                <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0">
                  <label className="p-2.5 bg-brand-bg hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-brand-border rounded-xl cursor-pointer flex items-center justify-center transition">
                    <Paperclip className="w-4 h-4" />
                    <input
                      id="file-packet-uploader"
                      type="file"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={uploadProgress !== null}
                    />
                  </label>

                  <input
                    id="chat-message-input"
                    type="text"
                    placeholder="Encrypted uplink message..."
                    className="flex-grow bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-accent font-sans"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                  />

                  <button
                    id="chat-send-submit-btn"
                    type="submit"
                    className="p-2.5 bg-brand-accent text-slate-950 hover:brightness-110 rounded-xl flex items-center justify-center transition cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>

              </div>
            )}

            {/* TAB: WORKSPACE FILES */}
            {activeTab === "files" && (
              <div className="h-full flex flex-col justify-start">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">
                  <FolderClosed className="w-4 h-4 text-brand-accent" />
                  Shared Document Repository
                </div>

                {sharedFiles.length === 0 ? (
                  <div className="text-center py-10 text-xs font-mono text-slate-500">
                    No files have currently been committed to the secure terminal bucket. Use the clip to upload.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {sharedFiles.map((f) => (
                      <div
                        key={f.id}
                        className="bg-brand-bg border border-brand-border p-3 rounded-xl flex items-center justify-between gap-2 text-xs hover:border-brand-accent transition"
                      >
                        <div className="min-w-0 flex-grow font-sans">
                          <p className="font-semibold text-slate-300 truncate text-xs break-all leading-snug">{f.file_name || "Document"}</p>
                          <p className="text-[9px] font-mono text-slate-500 mt-1 uppercase">FROM: {f.user_name}</p>
                        </div>
                        <a
                          id={`download-file-btn-${f.id}`}
                          href={f.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-brand-panel border border-brand-border text-brand-accent p-2 rounded-lg hover:border-brand-accent transition scale-90"
                          title="Download document file"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: SECURE WHITEBOARD CANVAS */}
            {activeTab === "whiteboard" && (
              <div className="h-full flex flex-col justify-between">
                <DrawingWhiteboard roomId={roomId} socket={socketRef.current} userId={currentUser?.uid || ""} />
              </div>
            )}

            {/* TAB: SESSION RECORDINGS */}
            {activeTab === "recordings" && (
              <div className="h-full flex flex-col justify-start">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                    <CircleDot className="w-4 h-4 text-red-500" />
                    Archive Logs & Recordings
                  </div>
                  
                  {isHost && (
                    <button
                      id="recording-action-toggle-btn"
                      onClick={isRecording ? stopRecordingSession : startRecordingSession}
                      className={`text-[9px] font-mono uppercase tracking-wider font-bold px-3 py-1 rounded-lg border transition cursor-pointer ${
                        isRecording 
                          ? "bg-red-500 text-slate-950 border-red-400 flex items-center gap-1"
                          : "bg-brand-bg border-brand-border text-slate-400 hover:text-slate-100"
                      }`}
                    >
                      {isRecording ? (
                        <>
                          <Square className="w-2.5 h-2.5 fill-slate-950 animate-pulse" /> End Rec
                        </>
                      ) : (
                        "Begin Record"
                      )}
                    </button>
                  )}
                </div>

                {recordings.length === 0 ? (
                  <div className="text-center py-10 text-xs font-mono text-slate-500">
                    No session recording assets are currently saved inside the operational vault logs.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                    {recordings.map((rec) => (
                      <div
                        key={rec.id}
                        className="bg-brand-bg border border-brand-border p-3 rounded-xl flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="font-sans leading-snug">
                          <p className="font-semibold text-slate-300">Session Stream Log</p>
                          <p className="text-[9px] font-mono text-slate-500 mt-1 flex items-center gap-1 uppercase">
                            Duration: <span className="text-brand-accent font-bold">{rec.duration_s}s</span>
                          </p>
                        </div>
                        <a
                          id={`download-recording-btn-${rec.id}`}
                          href={rec.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-red-950/45 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white rounded-lg text-xs font-mono flex items-center gap-1 cursor-pointer transition"
                          title="Stream playback"
                        >
                          <Play className="w-3.5 h-3.5 fill-red-400" /> Play
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: PEOPLE / PARTICIPANTS */}
            {activeTab === "people" && (
              <div className="h-full flex flex-col justify-start">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">
                  <Users className="w-4 h-4 text-brand-accent" />
                  Operatives Engaged ({socketParticipants.length})
                </div>

                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  
                  {/* Current Local Operative listing */}
                  <div className="bg-brand-bg border border-brand-border p-2.5 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-brand-accent shadow-[0_0_8px_#14b8a6] animate-pulse" />
                      <div>
                        <p className="font-semibold text-slate-300">{currentUser?.displayName || "You"} (Host/Me)</p>
                        <p className="text-[8px] font-mono text-slate-500 uppercase">LOCAL TRANSMITTER SOURCE</p>
                      </div>
                    </div>
                  </div>

                  {/* Other connected operators list */}
                  {socketParticipants
                    .filter((p) => p.userId !== currentUser?.uid)
                    .map((p) => (
                      <div
                        key={p.socketId}
                        className="bg-brand-bg border border-brand-border p-2.5 rounded-xl flex items-center justify-between text-xs hover:border-brand-accent transition"
                      >
                        <div className="flex items-center gap-2">
                          <img
                            src={p.avatar}
                            alt="Avatar"
                            className="w-5 h-5 rounded bg-brand-panel"
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <p className="font-semibold text-slate-300">{p.name}</p>
                            <p className="text-[8px] font-mono text-slate-500 uppercase flex items-center gap-1">
                              SECURE_COUPLE: <span className="text-brand-accent font-bold">{p.socketId.slice(0, 6)}</span>
                            </p>
                          </div>
                        </div>

                        {/* Kick action (Host-authorized) */}
                        {isHost && (
                          <button
                            id={`kick-participant-btn-${p.socketId}`}
                            onClick={() => handleKickParticipant(p.socketId, p.name)}
                            className="p-1.5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-transparent hover:border-red-500/30 rounded-lg transition"
                            title="Deauthorize operative session"
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}

                </div>
              </div>
            )}

          </div>

        </aside>

      </main>

      {/* Control command toolbar at the bottom */}
      <footer className="bg-slate-900 border-t border-slate-850 px-4 py-3 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-4 z-40">
        
        {/* Status ticker */}
        <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-slate-500">
          <Activity className="w-3.5 h-3.5 text-brand-accent animate-pulse" />
          <span>CYBERNET SYSTEM UPLINK SECURE</span>
        </div>

        {/* Central interactive buttons */}
        <div id="controls-panel" className="flex items-center gap-4">
          
          {/* Mute/Unmute Mic Toggle */}
          <button
            id="toggle-audio-btn"
            onClick={toggleAudio}
            className={`w-12 h-12 rounded-full border transition-all duration-200 cursor-pointer flex items-center justify-center ${
              isMuted
                ? "bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.25)]"
                : "bg-[#0c0e12] border-brand-border text-slate-300 hover:text-white hover:border-brand-accent hover:bg-slate-804"
            }`}
            title={isMuted ? "Engage Voice Transmission" : "Mute Transmission"}
          >
            {isMuted ? <MicOff className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Camera ON/OFF Toggle */}
          <button
            id="toggle-video-btn"
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full border transition-all duration-200 cursor-pointer flex items-center justify-center ${
              isCamOff
                ? "bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.25)]"
                : "bg-[#0c0e12] border-brand-border text-slate-300 hover:text-white hover:border-brand-accent hover:bg-slate-804"
            }`}
            title={isCamOff ? "Enable Video Feed" : "Disable Video Feed"}
          >
            {isCamOff ? <VideoOff className="w-5 h-5 animate-pulse" /> : <VideoIcon className="w-5 h-5" />}
          </button>

          {/* Screen Share Toggle */}
          <button
            id="toggle-screenshare-btn"
            onClick={toggleScreenShare}
            className={`w-12 h-12 rounded-full border transition-all duration-200 cursor-pointer flex items-center justify-center ${
              isScreenSharing
                ? "bg-brand-accent text-slate-950 border-brand-accent shadow-[0_0_12px_#14b8a6] font-bold scale-102"
                : "bg-[#0c0e12] border-brand-border text-slate-300 hover:text-white hover:border-brand-accent hover:bg-slate-804"
            }`}
            title="Toggle Desktop Screen Capture Mode"
          >
            <Monitor className="w-5 h-5" />
          </button>

        </div>

        {/* Current status display clock */}
        <div className="hidden md:block text-[10px] font-mono text-slate-500">
          UTC LINKTIME: {new Date().toUTCString().slice(17, 25)}
        </div>

      </footer>

      {/* End Session Custom Tactical Modal */}
      {showEndSessionConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-[#0e1117] border border-red-500/40 rounded-xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">
            {/* Warning top status line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-600"></div>
            
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-500">
                <span className="text-xl font-mono">⚠️</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Dismantle Tactical Frequency
                </h3>
                <p className="text-[10px] font-mono text-red-400">HOST_AUTHORIZATION_REQUIRED</p>
              </div>
            </div>

            <p className="text-slate-300 text-xs mb-6 leading-relaxed">
              Are you absolutely certain you want to dismantle, terminate, and decommission this interactive room? This operation cannot be reversed and will disconnect all participants instantly.
            </p>

            <div className="flex items-center justify-end gap-3 font-mono text-[11px]">
              <button
                id="cancel-end-session-btn"
                onClick={() => setShowEndSessionConfirm(false)}
                className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-lg border border-brand-border transition cursor-pointer font-bold uppercase tracking-widest"
              >
                Abort
              </button>
              <button
                id="confirm-end-session-btn"
                onClick={() => {
                  setShowEndSessionConfirm(false);
                  executeEndSession();
                }}
                className="px-4 py-2 bg-red-950 hover:bg-red-900 border border-red-500 text-red-200 hover:text-white rounded-lg transition cursor-pointer font-bold uppercase tracking-widest"
              >
                Terminate Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kick Operative Custom Tactical Modal */}
      {showKickConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-[#0e1117] border border-red-500/40 rounded-xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">
            {/* Warning top status line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-600"></div>
            
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-500">
                <span className="text-xl font-mono">⚠️</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Revoke Tactical Access
                </h3>
                <p className="text-[10px] font-mono text-red-400">OPERATIVE_DECONSTITUTION</p>
              </div>
            </div>

            <p className="text-slate-300 text-xs mb-6 leading-relaxed">
              Are you sure you want to terminate operative <span className="text-red-400 font-bold font-mono">{showKickConfirm.name}</span>'s session, disconnecting them from this secure communication frequency?
            </p>

            <div className="flex items-center justify-end gap-3 font-mono text-[11px]">
              <button
                id="cancel-kick-btn"
                onClick={() => setShowKickConfirm(null)}
                className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-lg border border-brand-border transition cursor-pointer font-bold uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                id="confirm-kick-btn"
                onClick={() => {
                  executeKickParticipant(showKickConfirm.targetSocketId);
                  setShowKickConfirm(null);
                }}
                className="px-4 py-2 bg-red-950 hover:bg-red-900 border border-red-500 text-red-200 hover:text-white rounded-lg transition cursor-pointer font-bold uppercase tracking-widest"
              >
                Revoke Credentials
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
