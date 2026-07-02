import { initializeApp } from "firebase/app";
import {
  getFirestore,
  enableIndexedDbPersistence
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDP508r6VgZ3ua1iNFsxyKp6rMkWUCIjbc",
  authDomain: "magic-order-59b42.firebaseapp.com",
  projectId: "magic-order-59b42",
  storageBucket: "magic-order-59b42.firebasestorage.app",
  messagingSenderId: "243572952772",
  appId: "1:243572952772:web:71f6441887fd0a7f998391"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

signInAnonymously(auth).catch(console.error);

enableIndexedDbPersistence(db).catch(console.error);
