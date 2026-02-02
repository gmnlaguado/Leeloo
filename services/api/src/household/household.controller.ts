import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { HouseholdService } from './household.service';

type AuthedRequest = {
  user: { id: string; claims?: any };
};

@ApiTags('household')
@Controller('household')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class HouseholdController {
  constructor(private readonly householdService: HouseholdService) {}

  @Get('contacts')
  @ApiOperation({ summary: 'List household contacts' })
  async list(@Req() req: AuthedRequest) {
    return this.householdService.listContacts(req.user.id);
  }

  @Post('contacts')
  @ApiOperation({ summary: 'Create household contact' })
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { role?: string | null; name: string; email?: string | null; phone?: string | null },
  ) {
    return this.householdService.createContact(req.user.id, body);
  }

  @Patch('contacts/:id')
  @ApiOperation({ summary: 'Update household contact' })
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { role?: string | null; name?: string; email?: string | null; phone?: string | null },
  ) {
    return this.householdService.updateContact(req.user.id, id, body);
  }

  @Delete('contacts/:id')
  @ApiOperation({ summary: 'Delete household contact' })
  async del(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.householdService.deleteContact(req.user.id, id);
  }
}
