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
    @Body() body: { name: string; role: string; age?: number },
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
}
