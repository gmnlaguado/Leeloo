import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type WeatherPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export type HourlySlot = {
  hour: number;       // 0-23
  temp: number;       // °C
  feels_like: number;
  rain_mm: number;    // mm/3h
  condition: string;  // 'Clear' | 'Rain' | 'Clouds' | etc.
  icon: string;       // OWM icon code e.g. '10d'
};

export type WeatherResponse = {
  city: string;
  country: string;
  timezone_offset: number;
  current: {
    temp: number;
    feels_like: number;
    humidity: number;
    condition: string;
    description: string;
    icon: string;
    wind_kph: number;
  };
  today: {
    temp_min: number;
    temp_max: number;
    sunrise: number;  // unix UTC
    sunset: number;
  };
  hourly: HourlySlot[];           // next 24 h, 3-hour steps
  rain_alert: RainAlert | null;
};

export type RainAlert = {
  period: WeatherPeriod;
  hour: number;       // first hour with rain
  rain_mm: number;
  message_es: string;
  message_en: string;
  message_pt: string;
  message_fr: string;
};

const PERIOD_RANGES: Record<WeatherPeriod, [number, number]> = {
  morning:   [6,  12],
  afternoon: [12, 18],
  evening:   [18, 22],
  night:     [22, 6],
};

function detectPeriod(hour: number): WeatherPeriod {
  if (hour >= 6  && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

const PERIOD_LABELS = {
  es: { morning: 'en la mañana', afternoon: 'en la tarde', evening: 'en la noche', night: 'durante la noche' },
  en: { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' },
  pt: { morning: 'de manhã', afternoon: 'à tarde', evening: 'à noite', night: 'durante a noite' },
  fr: { morning: 'le matin', afternoon: 'l\'après-midi', evening: 'le soir', night: 'la nuit' },
};

@Injectable()
export class WeatherService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openweathermap.org/data/2.5';

  constructor(private readonly cfg: ConfigService) {
    this.apiKey = cfg.get<string>('OPENWEATHER_API_KEY') ?? '';
  }

  async getWeather(city: string, countryCode?: string): Promise<WeatherResponse> {
    const q = countryCode ? `${city},${countryCode}` : city;

    const [currentRes, forecastRes] = await Promise.all([
      axios.get(`${this.baseUrl}/weather`, {
        params: { q, appid: this.apiKey, units: 'metric', lang: 'es' },
        timeout: 8000,
      }),
      axios.get(`${this.baseUrl}/forecast`, {
        params: { q, appid: this.apiKey, units: 'metric', cnt: 8 }, // 24h, 3h steps
        timeout: 8000,
      }),
    ]);

    const c = currentRes.data;
    const f = forecastRes.data;

    // Build hourly slots from forecast (3h steps)
    const hourly: HourlySlot[] = (f.list ?? []).map((item: any) => ({
      hour: new Date(item.dt * 1000).getHours(),
      temp: Math.round(item.main.temp),
      feels_like: Math.round(item.main.feels_like),
      rain_mm: item.rain?.['3h'] ?? 0,
      condition: item.weather?.[0]?.main ?? 'Clear',
      icon: item.weather?.[0]?.icon ?? '01d',
    }));

    // Find first rain slot with significant rain
    const rainSlot = hourly.find((h) => h.rain_mm > 0.5);
    let rain_alert: RainAlert | null = null;
    if (rainSlot) {
      const period = detectPeriod(rainSlot.hour);
      const pl = PERIOD_LABELS;
      rain_alert = {
        period,
        hour: rainSlot.hour,
        rain_mm: rainSlot.rain_mm,
        message_es: `Va a llover ${pl.es[period]}${rainSlot.hour ? ` (~${rainSlot.hour}:00)` : ''}. Recuerda llevar paraguas. ☂️`,
        message_en: `Rain expected ${pl.en[period]}${rainSlot.hour ? ` (~${rainSlot.hour}:00)` : ''}. Don't forget your umbrella. ☂️`,
        message_pt: `Chuva prevista ${pl.pt[period]}${rainSlot.hour ? ` (~${rainSlot.hour}:00)` : ''}. Não se esqueça do guarda-chuva. ☂️`,
        message_fr: `Pluie attendue ${pl.fr[period]}${rainSlot.hour ? ` (~${rainSlot.hour}:00)` : ''}. N'oubliez pas votre parapluie. ☂️`,
      };
    }

    const tzOffset = c.timezone ?? 0;
    const sunriseLocal = c.sys.sunrise + tzOffset;
    const sunsetLocal  = c.sys.sunset  + tzOffset;

    // today min/max from forecast list
    const temps = (f.list ?? []).map((i: any) => i.main.temp as number);
    const temp_min = temps.length ? Math.round(Math.min(...temps, c.main.temp_min)) : Math.round(c.main.temp_min);
    const temp_max = temps.length ? Math.round(Math.max(...temps, c.main.temp_max)) : Math.round(c.main.temp_max);

    return {
      city: c.name,
      country: c.sys.country,
      timezone_offset: tzOffset,
      current: {
        temp: Math.round(c.main.temp),
        feels_like: Math.round(c.main.feels_like),
        humidity: c.main.humidity,
        condition: c.weather?.[0]?.main ?? 'Clear',
        description: c.weather?.[0]?.description ?? '',
        icon: c.weather?.[0]?.icon ?? '01d',
        wind_kph: Math.round((c.wind?.speed ?? 0) * 3.6),
      },
      today: { temp_min, temp_max, sunrise: sunriseLocal, sunset: sunsetLocal },
      hourly,
      rain_alert,
    };
  }
}
