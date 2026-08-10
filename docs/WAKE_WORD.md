# Wake Word "Hey Leeloo" — Mobile Implementation Guide

## How it works

When the phone is locked or the app is in background, the device mic listens for "Hey Leeloo" using an on-device model (no cloud, no battery drain). When detected, the app opens, wakes Leeloo, and she greets the user.

The backend already handles the wake signal via `SYSTEM_WAKE` in `ExecutiveSupervisor`. The mobile app just needs to:
1. Detect the wake word
2. Open the app / start recording
3. Send to the normal voice pipeline

---

## Implementation

### 1. Install Picovoice Porcupine (free tier: 3 devices)

```bash
npx expo install @picovoice/porcupine-react-native
```

### 2. Train custom wake word

1. Go to https://console.picovoice.ai
2. Create account → **Wake Word** → **Custom**
3. Type: `Hey Leeloo`
4. Download `.ppn` model file for iOS + Android
5. Place files in:
   - `assets/wake-words/hey-leeloo_ios.ppn`
   - `assets/wake-words/hey-leeloo_android.ppn`

### 3. Background service (React Native)

```typescript
// services/wake-word.service.ts
import { Platform } from 'react-native';
import { PorcupineManager } from '@picovoice/porcupine-react-native';

const ACCESS_KEY = process.env.EXPO_PUBLIC_PICOVOICE_KEY!;
const MODEL_PATH = Platform.OS === 'ios'
  ? 'hey-leeloo_ios.ppn'
  : 'hey-leeloo_android.ppn';

export async function startWakeWordListener(onDetected: () => void) {
  const manager = await PorcupineManager.fromKeywordPaths(
    ACCESS_KEY,
    [MODEL_PATH],
    (keywordIndex) => {
      if (keywordIndex === 0) onDetected();
    },
  );
  await manager.start();
  return manager;
}
```

### 4. On wake detection

```typescript
// In your app's root component or background task
startWakeWordListener(async () => {
  // 1. Wake the screen (platform-specific)
  // 2. Call Leeloo API to log the wake event
  await fetch(`${API_URL}/v1/voice/wake`, { method: 'POST', headers: authHeaders });
  // 3. Start recording immediately
  navigation.navigate('VoiceScreen', { autoStart: true });
});
```

### 5. iOS permissions (Info.plist)

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Leeloo listens for "Hey Leeloo" to activate hands-free.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

### 6. Android permissions (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
```

---

## Backend: Wake event already supported

The backend `ExecutiveSupervisor` already recognizes:
- "hey leeloo" / "hey lilo" / "hey lilu"
- "leeloo wake up"
- "despierta leeloo"
- "oye leeloo"

And returns `{ kind: 'SYSTEM_WAKE' }` → Leeloo greets the user and sets `system_on = true`.

---

## Greeting response

When `SYSTEM_WAKE` is received in `voice.service.ts`, Leeloo should reply with a contextual greeting. The wake greeting currently returns a static string. To make it dynamic, the morning briefing data (today's agenda) can be fetched and included.
