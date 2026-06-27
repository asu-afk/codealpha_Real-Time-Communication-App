import express from "express";
import http from "http";
import path from "path";
import { Server as SocketServer, Socket } from "socket.io";
import { createServer as createViteServer } from "vite";

interface Participant {
  socketId: string;
  userId: string;
  name: string;
  avatar: string;
  cameraOn: boolean;
  micOn: boolean;
  screenShareOn: boolean;
}

// In-memory active rooms tracking (for WebRTC signaling)
const activeRooms = new Map<string, Participant[]>();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  // Initialize Socket.io signaling server
  const io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Standard JSON and URL encoded parsers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API endpoints (e.g. Server Health)
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRoomsCount: activeRooms.size });
  });

  // Socket.io WebRTC mesh signaling
  io.on("connection", (socket: Socket) => {
    let currentRoomId: string | null = null;
    let currentUserId: string | null = null;

    // Join room
    socket.on("join", (data: { roomId: string; userId: string; name: string; avatar: string }) => {
      const { roomId, userId, name, avatar } = data;
      currentRoomId = roomId;
      currentUserId = userId;

      socket.join(roomId);

      // Add to room's participant active list
      if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, []);
      }
      
      const participants = activeRooms.get(roomId)!;
      // Ensure no duplicate userId in the list for the current socket
      const existingIdx = participants.findIndex(p => p.userId === userId);
      const participantData: Participant = {
        socketId: socket.id,
        userId,
        name,
        avatar,
        cameraOn: true,
        micOn: true,
        screenShareOn: false
      };

      if (existingIdx !== -1) {
        participants[existingIdx] = participantData;
      } else {
        participants.push(participantData);
      }

      // Notify others and send list of existing participants to the joiner
      socket.to(roomId).emit("user-joined", {
        socketId: socket.id,
        userId,
        name,
        avatar
      });

      // Send list of other active sockets to the new joiner
      const otherParticipants = participants.filter(p => p.socketId !== socket.id);
      socket.emit("room-users", otherParticipants);

      // Broadcast updated participant list
      io.to(roomId).emit("participant-update", participants);
    });

    // Toggle camera / mic state
    socket.on("state-toggle", (data: { cameraOn?: boolean; micOn?: boolean; screenShareOn?: boolean }) => {
      if (!currentRoomId || !currentUserId) return;
      
      const participants = activeRooms.get(currentRoomId);
      if (participants) {
        const p = participants.find(part => part.userId === currentUserId);
        if (p) {
          if (data.cameraOn !== undefined) p.cameraOn = data.cameraOn;
          if (data.micOn !== undefined) p.micOn = data.micOn;
          if (data.screenShareOn !== undefined) p.screenShareOn = data.screenShareOn;
          
          io.to(currentRoomId).emit("participant-update", participants);
        }
      }
    });

    // Relay SDP Offer
    socket.on("offer", (data: { toSocketId: string; offerSignal: any }) => {
      io.to(data.toSocketId).emit("offer", {
        fromSocketId: socket.id,
        offerSignal: data.offerSignal
      });
    });

    // Relay SDP Answer
    socket.on("answer", (data: { toSocketId: string; answerSignal: any }) => {
      io.to(data.toSocketId).emit("answer", {
        fromSocketId: socket.id,
        answerSignal: data.answerSignal
      });
    });

    // Relay ICE candidate
    socket.on("ice-candidate", (data: { toSocketId: string; candidate: any }) => {
      io.to(data.toSocketId).emit("ice-candidate", {
        fromSocketId: socket.id,
        candidate: data.candidate
      });
    });

    // Whiteboard stroke transmission (real-time broadcast)
    socket.on("whiteboard:stroke", (data: { roomId: string; stroke: any }) => {
      socket.to(data.roomId).emit("whiteboard:stroke", data.stroke);
    });

    // Whiteboard clear broadcast
    socket.on("whiteboard:clear", (data: { roomId: string }) => {
      socket.to(data.roomId).emit("whiteboard:clear");
    });

    // Signalling Kick Operative
    socket.on("kick-operative", (data: { toSocketId: string }) => {
      io.to(data.toSocketId).emit("kicked", { message: "You have been terminated from the session by the Command Host." });
    });

    // Leave room
    const handleLeave = () => {
      if (!currentRoomId || !currentUserId) return;
      const roomId = currentRoomId;
      
      socket.leave(roomId);

      if (activeRooms.has(roomId)) {
        let participants = activeRooms.get(roomId)!;
        participants = participants.filter(p => p.socketId !== socket.id);
        
        if (participants.length === 0) {
          activeRooms.delete(roomId);
        } else {
          activeRooms.set(roomId, participants);
          io.to(roomId).emit("participant-update", participants);
          socket.to(roomId).emit("user-left", {
            socketId: socket.id,
            userId: currentUserId
          });
        }
      }

      currentRoomId = null;
      currentUserId = null;
    };

    socket.on("leave", handleLeave);
    socket.on("disconnect", handleLeave);
  });

  // Vite integration as middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind server to port 3000
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Server startup failed:", err);
});
