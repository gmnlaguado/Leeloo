import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { FamilyService } from './family.service';

type AuthedRequest = { user?: { id: string } };

@ApiTags('family')
@Controller('family')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  @Post('members')
  @ApiOperation({ summary: 'Add a family member' })
  async add(
    @Req() req: AuthedRequest,
    @Body() body: { name: string; role: string; age?: number; whatsapp?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const member = await this.familyService.addMember(userId, body);
    return { ok: true, member };
  }

  @Get('members')
  @ApiOperation({ summary: 'List all family members' })
  async list(@Req() req: AuthedRequest) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, members: [] };
    const members = await this.familyService.listMembers(userId);
    return { ok: true, members };
  }

  @Post('message')
  @ApiOperation({ summary: 'Log a message sent to a family member via Leeloo' })
  async message(
    @Req() req: AuthedRequest,
    @Body() body: { member_id: string; text: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    // Persists the message attempt; actual WhatsApp delivery is via voice pipeline
    await this.familyService.logMessage(userId, body.member_id, body.text);
    return { ok: true };
  }
}
