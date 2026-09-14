/**
 * deviceLocation.ts
 *
 * Returns the device's current GPS coordinates and resolved city name.
 * Called once per voice request — result is cached 5 min so we don't hammer GPS.
 * If the user denies location permission, returns null gracefully (Leeloo falls
 * back to the city saved in the user profile or asks the user directly).
 */
import * as Location from 'expo-location';

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
  timezone: string;
}

let cache: { data: DeviceLocation | null; ts: number } = { data: null, ts: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export async function getDeviceLocation(): Promise<DeviceLocation | null> {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL_MS) return cache.data;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, // fast enough, ~50m accuracy
    });

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Reverse geocode to get city name
    let city: string | undefined;
    let country: string | undefined;
    try {
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      city = geo?.city || geo?.subregion || undefined;
      country = geo?.country || undefined;
    } catch {
      // Geocoding failure is non-fatal — lat/lon still sent
    }

    const result: DeviceLocation = {
      latitude: Number(pos.coords.latitude.toFixed(4)),
      longitude: Number(pos.coords.longitude.toFixed(4)),
      city,
      country,
      timezone: tz,
    };

    cache = { data: result, ts: now };
    return result;
  } catch {
    return null;
  }
}

/** Call this when the user explicitly updates their location in settings */
export function clearLocationCache() {
  cache = { data: null, ts: 0 };
}
