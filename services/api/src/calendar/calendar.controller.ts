import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { UpdateReminderSettingsDto } from './dto/update-reminder-settings.dto';

type AuthedRequest = {
  user: { id: string };
};

@ApiTags('calendar')
@Controller('calendar')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post('events')
  @ApiOperation({ summary: 'Create a calendar event' })
  async createEvent(@Req() req: AuthedRequest, @Body() dto: CreateCalendarEventDto) {
    return this.calendarService.createEvent(req.user.id, dto);
  }

  @Put('events/:id')
  @ApiOperation({ summary: 'Update a calendar event' })
  async updateEvent(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.updateEvent(req.user.id, id, dto);
  }

  @Delete('events/:id')
  @ApiOperation({ summary: 'Delete a calendar event' })
  async deleteEvent(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.calendarService.deleteEvent(req.user.id, id);
  }

  @Get('events/search')
  @ApiOperation({ summary: 'Search upcoming events by title (fuzzy)' })
  async searchEvents(@Req() req: AuthedRequest, @Query('q') q: string) {
    if (!q?.trim()) return [];
    return this.calendarService.searchEvents(req.user.id, q.trim());
  }

  @Get('events')
  @ApiOperation({ summary: 'Get events for a given day' })
  async getEventsForDay(@Req() req: AuthedRequest, @Query('day') day: string) {
    const events = await this.calendarService.getEventsForDay(req.user.id, day);
    return events;
  }

  @Get('agenda/today')
  @ApiOperation({ summary: "Get today's agenda" })
  async getAgendaToday(@Req() req: AuthedRequest) {
    return this.calendarService.getAgendaToday(req.user.id);
  }

  @Get('agenda')
  @ApiOperation({ summary: 'Get unified agenda (events + tasks) for a given day' })
  async getUnifiedAgendaForDay(@Req() req: AuthedRequest, @Query('day') day: string) {
    return this.calendarService.getUnifiedAgendaForDay(req.user.id, day);
  }

  @Post('events/:id/attendees')
  @ApiOperation({ summary: 'Add attendees to an existing calendar event' })
  async addAttendees(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { attendees: Array<{ name: string; email: string }> },
  ) {
    const attendees = Array.isArray(body?.attendees) ? body.attendees : [];
    if (!attendees.length) throw new BadRequestException('attendees array is required');
    return this.calendarService.addAttendees(req.user.id, id, attendees);
  }

  @Put('reminder-settings')
  @ApiOperation({ summary: 'Update reminder settings (including Expo push token)' })
  async updateReminderSettings(@Req() req: AuthedRequest, @Body() dto: UpdateReminderSettingsDto) {
    return this.calendarService.updateReminderSettings(req.user.id, dto);
  }
}
