import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { MemoriesService } from './memories.service';

type AuthedRequest = {
  user: { id: string; claims?: any };
};

@ApiTags('memories')
@Controller('memories')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MemoriesController {
  constructor(private readonly memoriesService: MemoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List memories (optionally filter by prefix/category)' })
  async list(
    @Req() req: AuthedRequest,
    @Query('prefix') prefix?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    return this.memoriesService.listMemories(req.user.id, {
      prefix: typeof prefix === 'string' ? prefix : undefined,
      category: typeof category === 'string' ? category : undefined,
      limit: Number.isFinite(n as any) ? (n as any) : undefined,
    });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search memories by relevance (full-text)' })
  async search(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    return this.memoriesService.getRelevantMemories(
      req.user.id,
      typeof q === 'string' ? q : '',
      Number.isFinite(n as any) ? (n as any) : 10,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create memory' })
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { category: string; key: string; value: any },
  ) {
    const category = String(body?.category || '').trim();
    const key = String(body?.key || '').trim();
    const value = (body as any)?.value;
    return this.memoriesService.createMemory(req.user.id, category, key, value);
  }
}
