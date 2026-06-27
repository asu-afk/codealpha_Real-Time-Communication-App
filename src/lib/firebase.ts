import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDHqcGkChqqZ9PppNvIkPPDVmedhTT7vtI",
  authDomain: "tensile-meridian-8f4nj.firebaseapp.com",
  projectId: "tensile-meridian-8f4nj",
  storageBucket: "tensile-meridian-8f4nj.firebasestorage.app",
  messagingSenderId: "581926723469",
  appId: "1:581926723469:web:00ce571339a4848fdaa7c4"
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore utilizing the specific database ID created for this applet
const db = initializeFirestore(app, {}, "ai-studio-5c1cae66-4114-42bd-a3a0-449204de801e");
const auth = getAuth(app);
const storage = getStorage(app);

export { app, auth, db, storage };
export default app;
