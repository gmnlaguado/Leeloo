import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { ContactsService } from './contacts.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('contacts')
@Controller('contacts')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List all contacts for current user' })
  async list(@Req() req: AuthedRequest) {
    return this.contactsService.listContacts(req.user.id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Bulk sync contacts from mobile device (phone/Google/Microsoft)' })
  async sync(
    @Req() req: AuthedRequest,
    @Body() body: {
      contacts: Array<{
        name: string;
        email?: string;
        phone?: string;
        nickname?: string;
        relation?: string;
        source?: string;
      }>;
    },
  ) {
    const contacts = Array.isArray(body?.contacts) ? body.contacts : [];
    return this.contactsService.syncContacts(req.user.id, contacts);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a single contact' })
  async upsert(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name: string;
      email?: string;
      phone?: string;
      nickname?: string;
      relation?: string;
    },
  ) {
    return this.contactsService.upsertContact(req.user.id, body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a contact' })
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      name: string;
      email?: string;
      phone?: string;
      nickname?: string;
      relation?: string;
    },
  ) {
    return this.contactsService.upsertContact(req.user.id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a contact' })
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.contactsService.deleteContact(req.user.id, id);
  }
}
