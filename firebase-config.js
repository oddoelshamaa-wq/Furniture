import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCE7wo3Vwzap7MnP4rv9kFZNwKlFD1myMM",
  authDomain: "furniture-416b8.firebaseapp.com",
  projectId: "furniture-416b8",
  storageBucket: "furniture-416b8.firebasestorage.app",
  messagingSenderId: "827913239758",
  appId: "1:827913239758:web:2fef185ebcf07d80e5e49f",
  measurementId: "G-S13ED1JS79"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
