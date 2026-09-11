import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { WeatherService } from './weather.service';
import { ProfilesService } from '../profiles/profiles.service';

type AuthedRequest = { user?: { id: string } };

@ApiTags('weather')
@Controller('weather')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class WeatherController {
  constructor(
    private readonly weatherService: WeatherService,
    private readonly profilesService: ProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get weather for a city (defaults to user profile city)' })
  async getWeather(
    @Req() req: AuthedRequest,
    @Query('city') city?: string,
    @Query('country') country?: string,
  ) {
    let resolvedCity = city?.trim();

    // If no city param, use the profile city
    if (!resolvedCity && req.user?.id) {
      try {
        const profile = await this.profilesService.ensureProfileByClerkUserId(req.user.id);
        resolvedCity = (profile as any)?.city?.trim() || undefined;
      } catch { /* ignore */ }
    }

    if (!resolvedCity) {
      return { ok: false, error: 'No city provided and no city in profile.' };
    }

    try {
      const data = await this.weatherService.getWeather(resolvedCity, country);
      return { ok: true, weather: data };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Weather service error' };
    }
  }
}
