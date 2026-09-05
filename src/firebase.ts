import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// 검증용 빌드만 에뮬레이터를 본다 (`VITE_FIRESTORE_EMULATOR=127.0.0.1:8080 npm run build`, tide-check.yml).
// 프로덕션 빌드에는 이 변수가 없어 통째로 사라진다 — 실제 화면을 프로덕션 데이터 없이 찍어 보려는 용도다.
const emu = import.meta.env.VITE_FIRESTORE_EMULATOR as string | undefined;
if (emu) {
  const [host, port] = emu.split(':');
  connectFirestoreEmulator(db, host, Number(port));
}
